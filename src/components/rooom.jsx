// src/pages/MeetingRoom.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import axios from "axios";

const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL;
const API_URL = import.meta.env.VITE_API_BASE;

function MeetingRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  // User and auth state
  const [userData, setUserData] = useState(null);
  const token = useMemo(() => localStorage.getItem("token"), []);
  
  // Meeting state
  const localStreamRef = useRef(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  
  // WebRTC state
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const [remoteStreams, setRemoteStreams] = useState({});
  const [remoteUsers, setRemoteUsers] = useState({});
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const chatContainerRef = useRef(null);
  
  // DOM refs
  const localVideoRef = useRef(null);

  useEffect(() => {
    // Check authentication
    if (!token) {
      navigate(`/signin?room=${roomId}`);
      return;
    }

    // Fetch user data
    axios
      .get(`${API_URL}/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setUserData(res.data.user))
      .catch((err) => {
        console.error(err.response?.data || err);
        navigate(`/signin?room=${roomId}`);
      });

    // Initialize socket connection
    const s = io(API_URL, { auth: { token } });
    socketRef.current = s;

    s.on("connect", () => {
      console.log("socket connected:", s.id);
      s.emit("join-room", { roomId, username: userData?.username });
    });

    // WebRTC event handlers
    s.on("user-joined", async ({ socketId, username, userId }) => {
      if (socketId === s.id) return;
      
      // Store user info
      setRemoteUsers(prev => ({ ...prev, [socketId]: { username, userId } }));
      
      const pc = createPeerConnection(socketId);
      peersRef.current.set(socketId, pc);
      addLocalTracks(pc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      s.emit("signal", {
        roomId,
        to: socketId,
        data: { type: "offer", sdp: offer },
      });
    });

    s.on("signal", async ({ from, data }) => {
      if (from === s.id) return;

      let pc = peersRef.current.get(from);
      if (!pc) {
        pc = createPeerConnection(from);
        peersRef.current.set(from, pc);
        addLocalTracks(pc);
      }

      if (data.type === "offer") {
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        s.emit("signal", {
          roomId,
          to: from,
          data: { type: "answer", sdp: answer },
        });
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(data.sdp);
      } else if (data.type === "ice-candidate" && data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    });

    s.on("user-left", ({ socketId }) => {
      const pc = peersRef.current.get(socketId);
      if (pc) pc.close();
      peersRef.current.delete(socketId);
      setRemoteStreams((prev) => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
      setRemoteUsers(prev => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
    });

    // Chat event handlers
    s.on("receive-message", (message) => {
      setMessages(prev => [...prev, message]);
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 100);
    });

    // Admin control event
    s.on("meeting-ended", () => {
      leaveMeeting();
      alert("Meeting has been ended by the host");
    });

    // Initialize media
    ensureLocalStream();

    return () => {
      leaveMeeting();
      s.disconnect();
    };
  }, [roomId, token, navigate, userData]);

  async function ensureLocalStream() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }

  function addLocalTracks(pc) {
    if (!localStreamRef.current) return;
    localStreamRef.current
      .getTracks()
      .forEach((t) => pc.addTrack(t, localStreamRef.current));
  }

  function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setRemoteStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("signal", {
          roomId,
          to: peerId,
          data: { type: "ice-candidate", candidate: event.candidate },
        });
      }
    };

    return pc;
  }

  function stopAll() {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setRemoteStreams({});
    setRemoteUsers({});
  }

  const leaveMeeting = () => {
    if (socketRef.current && roomId)
      socketRef.current.emit("leave-room", { roomId });
    stopAll();
    navigate("/dashboard");
  };

  const endMeetingForAll = () => {
    if (socketRef.current && roomId) {
      socketRef.current.emit("end-meeting", { roomId });
    }
    leaveMeeting();
  };

  const copyInvite = async () => {
    const link = `${FRONTEND_URL}/room/${roomId}`;
    await navigator.clipboard.writeText(link);
    alert("Invite link copied!");
  };

  const toggleAudio = () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  };

  const toggleVideo = () => {
    const next = !videoEnabled;
    setVideoEnabled(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  };

  const shareScreen = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(screenTrack);
      });
      screenTrack.onended = toggleVideo;
    } catch (err) {
      console.error("share screen failed:", err);
    }
  };

  const sendMessage = () => {
    if (newMessage.trim() && socketRef.current) {
      const messageData = {
        sender: userData.username,
        message: newMessage.trim(),
        time: new Date().toLocaleTimeString(),
      };
      socketRef.current.emit("send-message", { roomId, message: messageData });
      setMessages(prev => [...prev, messageData]);
      setNewMessage("");
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 100);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  if (!userData) return <p style={{ padding: 16 }}>Loading...</p>;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #eee",
          gap: 12,
        }}
      >
        <span style={{ marginRight: "auto" }}>Meeting: {roomId}</span>
        <button onClick={copyInvite}>Copy Invite Link</button>
        <button onClick={toggleAudio}>
          {audioEnabled ? "Mute" : "Unmute"}
        </button>
        <button onClick={toggleVideo}>
          {videoEnabled ? "Stop Video" : "Start Video"}
        </button>
        <button onClick={shareScreen}>Share Screen</button>
        <button onClick={endMeetingForAll} style={{ color: "red" }}>
          End Meeting for All
        </button>
        <button onClick={leaveMeeting}>Leave Meeting</button>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Video Grid */}
        <div
          style={{
            flex: 3,
            padding: 16,
            background: "#f8fafc",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            overflow: "auto",
          }}
        >
          <VideoTile streamRef={localVideoRef} label={userData.username} isLocal={true} />
          {Object.entries(remoteStreams).map(([peerId, stream]) => (
            <RemoteTile
              key={peerId}
              stream={stream}
              label={remoteUsers[peerId]?.username || peerId.slice(0, 6)}
            />
          ))}
        </div>

        {/* Chat Panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: "1px solid #eee" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontWeight: "bold" }}>
            Chat
          </div>
          <div
            ref={chatContainerRef}
            style={{ flex: 1, padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}
          >
            {messages.map((msg, index) => (
              <div key={index} style={{ 
                display: "flex", 
                flexDirection: "column",
                alignSelf: msg.sender === userData.username ? "flex-end" : "flex-start",
                backgroundColor: msg.sender === userData.username ? "#e3f2fd" : "#f5f5f5",
                padding: "8px 12px",
                borderRadius: "12px",
                maxWidth: "80%"
              }}>
                <div style={{ fontSize: "12px", fontWeight: "bold" }}>
                  {msg.sender} {msg.sender === userData.username && "(You)"}
                </div>
                <div>{msg.message}</div>
                <div style={{ fontSize: "10px", color: "#666", alignSelf: "flex-end" }}>
                  {msg.time}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", padding: 16, borderTop: "1px solid #eee" }}>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              style={{ flex: 1, padding: "8px 12px", border: "1px solid #ddd", borderRadius: "4px 0 0 4px" }}
            />
            <button 
              onClick={sendMessage}
              style={{ padding: "8px 16px", backgroundColor: "#1976d2", color: "white", border: "none", borderRadius: "0 4px 4px 0" }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VideoTile({ streamRef, label, isLocal = false }) {
  return (
    <div
      style={{
        background: "#000",
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
        aspectRatio: "4/3",
      }}
    >
      <video
        ref={streamRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <span style={{ 
        position: "absolute", 
        bottom: 8, 
        left: 8, 
        color: "#fff", 
        backgroundColor: "rgba(0,0,0,0.5)", 
        padding: "4px 8px", 
        borderRadius: 4,
        fontSize: "14px"
      }}>
        {label}
      </span>
    </div>
  );
}

function RemoteTile({ stream, label }) {
  const vid = useRef(null);
  useEffect(() => {
    if (vid.current) vid.current.srcObject = stream;
  }, [stream]);
  return (
    <div
      style={{
        background: "#000",
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
        aspectRatio: "4/3",
      }}
    >
      <video
        ref={vid}
        autoPlay
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <span style={{ 
        position: "absolute", 
        bottom: 8, 
        left: 8, 
        color: "#fff", 
        backgroundColor: "rgba(0,0,0,0.5)", 
        padding: "4px 8px", 
        borderRadius: 4,
        fontSize: "14px"
      }}>
        {label}
      </span>
    </div>
  );
}

export default MeetingRoom;