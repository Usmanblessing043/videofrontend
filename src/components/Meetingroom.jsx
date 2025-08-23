import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import io from "socket.io-client";
import Peer from "simple-peer";

const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL;
const socket = io(`${backendUrl}/user`);

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [peers, setPeers] = useState([]);
  const peersRef = useRef({});
  const myVideo = useRef();
  const streamRef = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    let mounted = true;

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      if (!mounted) return;

      myVideo.current.srcObject = stream;
      streamRef.current = stream;

      socket.emit("join-room", roomId);

      socket.on("host", () => setIsHost(true));

      socket.on("all-users", (users) => {
        users.forEach((userId) => {
          if (!peersRef.current[userId]) {
            const peer = createPeer(userId, socket.id, stream);
            peersRef.current[userId] = peer;
            setPeers((prev) => [...prev, { peerId: userId, peer }]);
          }
        });
      });

      socket.on("receiving-signal", ({ signal, callerId }) => {
        let peer = peersRef.current[callerId];
        if (!peer) {
          peer = addPeer(signal, callerId, stream);
          peersRef.current[callerId] = peer;
          setPeers((prev) => [...prev, { peerId: callerId, peer }]);
        }
        
      });
      

      socket.on("receiving-returned-signal", ({ signal, id }) => {
        const peer = peersRef.current[id];
        if (peer) peer.signal(signal);
      });

      socket.on("user-left", (id) => {
        const peer = peersRef.current[id];
        if (peer) {
          peer.destroy();
          delete peersRef.current[id];
        }
        setPeers((users) => users.filter((p) => p.peerId !== id));
      });

      socket.on("chat-message", ({ user, message }) => {
        setMessages((prev) => [...prev, { user, message }]);
      });

      socket.on("end-call", () => {
        alert("Meeting has ended by host");
        cleanup();
        navigate("/Dashboard");
      });
    });

    return () => {
      mounted = false;
      cleanup();
      socket.removeAllListeners();
    };
  }, [roomId, navigate]);

  // ✅ TURN/STUN config
  const iceConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:relay1.expressturn.com:3478",
        username: "efG3knQJwOqN1HpXj1",
        credential: "8cG2RzTgN5kGv9P4",
      },
    ],
  };



  // ✅ Create Peer (initiator)
function createPeer(userToSignal, callerId, stream) {
  const peer = new Peer({
    initiator: true,
    trickle: false,
    stream,
    config: iceConfig,
  });

  peer.on("signal", (signal) => {
    socket.emit("sending-signal", { userToSignal, callerId, signal });
  });

  peer.on("error", (err) => console.error("Peer error (initiator):", err));

  return peer;
}

// ✅ Add Peer (answerer)
function addPeer(incomingSignal, callerId, stream) {
  const peer = new Peer({
    initiator: false,
    trickle: false,
    stream,
    config: iceConfig,
  });

  peer.on("signal", (signal) => {
    socket.emit("returning-signal", { callerId, signal });
  });

  peer.on("error", (err) => console.error("Peer error (answerer):", err));

  // 🚀 Fix: wrap signaling safely
  try {
    peer.signal(incomingSignal);
  } catch (err) {
    console.warn("Signal too early, will retry...");
    setTimeout(() => {
      try {
        peer.signal(incomingSignal);
      } catch (e) {
        console.error("Retry failed:", e);
      }
    }, 500);
  }

  return peer;
}


  const toggleMute = () => {
    const audioTrack = streamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  const toggleCamera = () => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  };

  const startScreenShare = async () => {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    Object.values(peersRef.current).forEach((peer) => {
      const sender = peer._pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) sender.replaceTrack(screenTrack);
    });
    myVideo.current.srcObject = screenStream;

    screenTrack.onended = () => {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      Object.values(peersRef.current).forEach((peer) => {
        const sender = peer._pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(videoTrack);
      });
      myVideo.current.srcObject = streamRef.current;
    };
  };

  const sendMessage = () => {
    if (input.trim()) {
      socket.emit("chat-message", { roomId, user: socket.id, message: input });
      setMessages((prev) => [...prev, { user: "Me", message: input }]);
      setInput("");
    }
  };

  const endCall = () => {
    socket.emit("end-call", roomId);
    cleanup();
    navigate("/Dashboard");
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    Object.values(peersRef.current).forEach((peer) => !peer.destroyed && peer.destroy());
    peersRef.current = {};
    setPeers([]);
  };

  return (
    <div>
      <h2>Room: {roomId}</h2>
      <div style={{ display: "flex", gap: "10px" }}>
        <video ref={myVideo} autoPlay muted playsInline style={{ width: "300px" }} />
        {peers.map(({ peerId, peer }) => (
          <Video key={peerId} peer={peer} />
        ))}
      </div>
      <div style={{ marginTop: "10px" }}>
        <button onClick={toggleMute}>{isMuted ? "Unmute" : "Mute"}</button>
        <button onClick={toggleCamera}>{isCameraOff ? "Turn Camera On" : "Turn Camera Off"}</button>
        <button onClick={startScreenShare}>Share Screen</button>
        {isHost && (
          <button onClick={endCall} style={{ background: "red", color: "white" }}>
            End Call
          </button>
        )}
      </div>
      <div style={{ marginTop: "20px", width: "250px" }}>
        <h3>Chat</h3>
        <div
          style={{
            border: "1px solid #ccc",
            height: "120px",
            overflowY: "auto",
            padding: "5px",
            background: "#f9f9f9",
          }}
        >
          {messages.map((msg, i) => (
            <p key={i}>
              <strong>{msg.user}: </strong>
              {msg.message}
            </p>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "5px" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            style={{ flex: 1 }}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      </div>
    </div>
  );
}

function Video({ peer }) {
  const ref = useRef();

  useEffect(() => {
    const handleStream = (stream) => {
      if (ref.current) {
        ref.current.srcObject = stream;
      }
    };

    peer.on("stream", handleStream);

    return () => {
      peer.removeListener("stream", handleStream);
    };
  }, [peer]);

  return <video ref={ref} autoPlay playsInline style={{ width: "300px" }} />;
}
