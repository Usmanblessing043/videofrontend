
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import axios from "axios";
import "./RoomMeeting.css";

const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL || "http://localhost:3022";
// const socket = io(backendUrl);

const Meetingroom = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  // User and auth state
  const [userData, setUserData] = useState(null);
  const token = useMemo(() => localStorage.getItem("token"), []);

  // Meeting state
  const localStreamRef = useRef(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  // WebRTC + Socket state
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const [remoteStreams, setRemoteStreams] = useState({});
  const [participants, setParticipants] = useState({}); // socketId -> username/email

  // Chat state
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  // DOM refs
  const localVideoRef = useRef(null);


  useEffect(() => {
    if (!token) {
      navigate(`/Meetingroom/${roomId}`);
      return;
    }

    // Fetch user data
    axios.get(`${backendUrl}/Verify`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setUserData(res.data.user))
      .catch((err) => {
        console.error(err.response?.data || err);
        navigate(`/Meetingroom/${roomId}`);
      });
  }, [token, navigate, roomId]);

  useEffect(() => {
    if (!userData) return;

    // Init socket
    const s = io(backendUrl, { auth: { token } });
    socketRef.current = s;

    s.on("connect", () => {
      console.log("socket connected:", s.id);
      s.emit("join-room", { roomId, username: userData.email });
    });

    // Handle peers
    s.on("user-joined", async ({ socketId, username }) => {
      setParticipants((p) => ({ ...p, [socketId]: username }));
      if (socketId === s.id) return;
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
      setParticipants((prev) => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
    });

    // Chat
    s.on("chat-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    // Meeting end
    s.on("end-meeting", () => {
      stopAll();
      navigate("/Dashboard");
    });

    ensureLocalStream();

    return () => {
      leaveMeeting(false);
      s.disconnect();
    };
  }, [userData, navigate, roomId]);



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
  }

  const leaveMeeting = (manual = true) => {
    if (socketRef.current && roomId)
      socketRef.current.emit("leave-room", { roomId });
    stopAll();
    if (manual) navigate("/dashboard");
  };

  const endMeeting = () => {
    if (!socketRef.current) return;
    if (userData.isCreator) {
      socketRef.current.emit("end-meeting", { roomId });
    } else {
      leaveMeeting();
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const msg = {
      user: userData?.email || "Guest",
      text: chatInput,
      time: new Date().toISOString(),
    };

    // Send to server
    socketRef.current.emit("chat-message", { roomId, ...msg });

    // Don't push locally (avoid duplicates) – only server response will update messages
    setChatInput("");
  };

  // const copyInvite = async () => {
  //   const link = `${FRONTEND_URL}/room/${roomId}`;
  //   await navigator.clipboard.writeText(link);
  //   alert("Invite link copied!");
  // };

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

  if (!userData) return <p style={{ padding: 16 }}>Loading...</p>;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top toolbar */}
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
        {/* <button onClick={copyInvite}>Copy Invite Link</button> */}
        <button onClick={toggleAudio}>
          {audioEnabled ? "Mute" : "Unmute"}
        </button>
        <button onClick={toggleVideo}>
          {videoEnabled ? "Start Audio" : "Start Video"}
        </button>
        <button onClick={shareScreen}>Share Screen</button>
        <button onClick={endMeeting} style={{ color: "red" }}>
          End Meeting
        </button>
      </div>

      {/* Main content: videos + chat */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "3fr 1fr" }}>
        {/* Videos grid */}
        <div
          style={{
            flex: 1,
            padding: 16,
            background: "#f8fafc",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          <VideoTile
            streamRef={localVideoRef}
            label={userData.isCreator ? "You" : userData.email}
            videoEnabled={videoEnabled}
            
          />
          {Object.entries(remoteStreams).map(([peerId, stream]) => (
            <RemoteTile
              key={peerId}
              stream={stream}
              label={participants[peerId] || peerId.slice(0, 6)}
            />
          ))}
        </div>

        {/* Chat panel */}
        <div
          style={{
            borderLeft: "1px solid #ddd",
            display: "flex",
            flexDirection: "column",
            background: "#fff",
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 12,
              fontSize: 14,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {messages.map((m, i) => {
              const isSelf = m.user === userData.email;
              return (
                <div
                  key={i}
                  style={{
                    alignSelf: isSelf ? "flex-end" : "flex-start",
                    background: isSelf ? "#dcf8c6" : "#f1f0f0",
                    padding: "8px 12px",
                    borderRadius: 12,
                    maxWidth: "70%",
                    marginBottom: 6,
                    position: "relative",
                  }}
                >
                  <div>{m.text}</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#555",
                      position: "absolute",
                      bottom: 2,
                      right: 8,
                    }}
                  >
                    {formatTime(m.time)}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            onSubmit={sendMessage}
            style={{
              display: "flex",
              borderTop: "1px solid #ddd",
              padding: 8,
              gap: 8,
            }}
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type a message..."
              style={{ flex: 1, padding: 8 }}
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function VideoTile({ streamRef, label, videoEnabled }) {
  return (
    <div
      style={{
        background: "#000",
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {videoEnabled ? (
        <video
          ref={streamRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "#4caf50",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
          }}
        >
          {label[0].toUpperCase()}
        </div>
      )}
      <span style={{ position: "absolute", bottom: 8, left: 8, color: "#fff" }}>
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
      }}
    >
      <video
        ref={vid}
        autoPlay
        playsInline
        style={{ width: "100%", height: "100%" }}
      />
      <span style={{ position: "absolute", bottom: 8, left: 8, color: "#fff" }}>
        {label}
      </span>
    </div>
  );
}

function formatTime(dateLike) {
  const d = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${m} ${ampm}`;
}

export default Meetingroom;   