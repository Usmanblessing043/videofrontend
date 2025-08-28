import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from 'react-toastify'
import io from "socket.io-client";
import Peer from "simple-peer";
import './RoomMeeting.css';

const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL;
const socket = io(`${backendUrl}/user`, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [peers, setPeers] = useState([]);
  const peersRef = useRef({});
  const myVideo = useRef();
  const streamRef = useRef(null);
  const screenStreamRef = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [participants, setParticipants] = useState(1);

  useEffect(() => {
    let mounted = true;

    // Socket connection events
    socket.on("connect", () => {
      console.log("Connected to server:", socket.id);
      setConnectionStatus("connected");
    });

    socket.on("connect_error", (err) => {
      console.error("Connection error:", err);
      setConnectionStatus("error");
      toast.error("Failed to connect to server");
    });

    socket.on("disconnect", () => {
      setConnectionStatus("disconnected");
    });

    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1280, height: 720 }, 
          audio: true 
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        myVideo.current.srcObject = stream;
        streamRef.current = stream;

        // Force play the video in case autoplay is blocked
        myVideo.current.play().catch(err => {
          console.warn("Autoplay prevented:", err);
        });

        socket.emit("join-room", roomId);

        socket.on("host", () => setIsHost(true));

        socket.on("all-users", (users) => {
          console.log("All users in room:", users);
          setParticipants(users.length + 1);
          users.forEach((userId) => {
            if (!peersRef.current[userId]) {
              const peer = createPeer(userId, socket.id, stream);
              peersRef.current[userId] = peer;
              setPeers((prev) => [...prev, { peerId: userId, peer }]);
            }
          });
        });

        socket.on("user-joined", (newUserId) => {
          console.log("🆕 User joined:", newUserId);
          setParticipants(prev => prev + 1);
          if (!peersRef.current[newUserId]) {
            const peer = createPeer(newUserId, socket.id, stream);
            peersRef.current[newUserId] = peer;
            setPeers((prev) => [...prev, { peerId: newUserId, peer }]);
          }
        });

        socket.on("receiving-signal", ({ signal, callerId }) => {
          console.log("📡 Receiving signal from:", callerId);
          let peer = peersRef.current[callerId];
          if (!peer) {
            console.log("Creating new peer for:", callerId);
            peer = addPeer(signal, callerId, stream);
            peersRef.current[callerId] = peer;
            setPeers((prev) => [...prev, { peerId: callerId, peer }]);
          } else {
            console.log("Existing peer found, signaling:", callerId);
            peer.signal(signal);
          }
        });

        socket.on("receiving-returned-signal", ({ signal, id }) => {
          console.log("📡 Receiving returned signal from:", id);
          const peer = peersRef.current[id];
          if (peer) {
            peer.signal(signal);
          } else {
            console.warn("Peer not found for returned signal:", id);
          }
        });

        socket.on("user-left", (id) => {
          console.log("User left:", id);
          setParticipants(prev => prev - 1);
          const peer = peersRef.current[id];
          if (peer) {
            peer.destroy();
            delete peersRef.current[id];
          }
          setPeers(users => users.filter(p => p.peerId !== id));
          toast.info(`Participant left the meeting`);
        });

        socket.on("chat-message", ({ user, message }) => {
          setMessages((prev) => [...prev, { user, message }]);
        });

        socket.on("end-call", () => {
          toast.success("Meeting has ended by host");
          cleanup();
          navigate("/Dashboard");
        });

        // Monitor peer connections for debugging
        const monitorInterval = setInterval(() => {
          Object.entries(peersRef.current).forEach(([peerId, peer]) => {
            if (peer._pc) {
              console.log(`Peer ${peerId} connection state:`, peer._pc.connectionState);
              console.log(`Peer ${peerId} ice connection state:`, peer._pc.iceConnectionState);
            }
          });
        }, 10000);

        return () => clearInterval(monitorInterval);

      } catch (err) {
        console.error("Error accessing media devices:", err);
        toast.error("Could not access camera/microphone. Please check permissions.");
        setConnectionStatus("error");
      }
    };

    getMedia();

    return () => {
      mounted = false;
      cleanup();
      socket.removeAllListeners();
    };
  }, [roomId, navigate]);

  // Enhanced ICE configuration with more reliable servers
  const iceConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      {
        urls: "turn:relay1.expressturn.com:3478",
        username: "efG3knQJwOqN1HpXj1",
        credential: "8cG2RzTgN5kGv9P4",
      },
      {
        urls: "turn:numb.viagenie.ca",
        username: "webrtc@live.com",
        credential: "password"
      },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ],
    iceCandidatePoolSize: 10,
    sdpSemantics: 'unified-plan'
  };
    
  // Caller (initiator)
  function createPeer(userToSignal, callerId, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: true,
      stream,
      config: iceConfig,
    });

    // Store the stream for later access
    peer.stream = stream;

    peer.on("signal", (signal) => {
      console.log("Caller signaling to:", userToSignal);
      socket.emit("sending-signal", { userToSignal, callerId, signal });
    });

    peer.on("stream", (remoteStream) => {
      console.log("Received remote stream from:", userToSignal);
    });

    peer.on("error", (err) => {
      console.error("Peer error (initiator):", err);
      delete peersRef.current[userToSignal];
      setPeers(prev => prev.filter(p => p.peerId !== userToSignal));
    });

    peer.on("close", () => {
      console.log("Peer connection closed:", userToSignal);
      delete peersRef.current[userToSignal];
      setPeers(prev => prev.filter(p => p.peerId !== userToSignal));
    });

    peer.on("connect", () => {
      console.log("Peer connected:", userToSignal);
    });

    return peer;
  }

  // Callee (answerer)
  function addPeer(incomingSignal, callerId, stream) {
    const peer = new Peer({
      initiator: false,
      trickle: true,
      stream,
      config: iceConfig,
    });

    // Store the stream for later access
    peer.stream = stream;

    peer.on("signal", (signal) => {
      console.log("Callee returning signal to:", callerId);
      socket.emit("returning-signal", { callerId, signal });
    });

    peer.on("stream", (remoteStream) => {
      console.log("Received remote stream from:", callerId);
    });

    peer.on("error", (err) => {
      console.error("Peer error (answerer):", err);
      delete peersRef.current[callerId];
      setPeers(prev => prev.filter(p => p.peerId !== callerId));
    });

    peer.on("close", () => {
      console.log("Peer connection closed:", callerId);
      delete peersRef.current[callerId];
      setPeers(prev => prev.filter(p => p.peerId !== callerId));
    });

    peer.on("connect", () => {
      console.log("Peer connected:", callerId);
    });

    try {
      peer.signal(incomingSignal);
    } catch (err) {
      console.warn("Signal too early, retrying...");
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
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!audioTracks[0].enabled);
    }
  };

  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsCameraOff(!videoTracks[0].enabled);
    }
  };

  const startScreenShare = async () => {
    try {
      if (isScreenSharing) {
        // Switch back to camera
        Object.values(peersRef.current).forEach((peer) => {
          const sender = peer._pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender && streamRef.current) {
            const videoTrack = streamRef.current.getVideoTracks()[0];
            sender.replaceTrack(videoTrack);
          }
        });
        myVideo.current.srcObject = streamRef.current;
        setIsScreenSharing(false);
        
        // Stop screen stream
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(track => track.stop());
          screenStreamRef.current = null;
        }
      } else {
        // Start screen share
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: "always" }, 
          audio: true 
        });
        screenStreamRef.current = screenStream;
        
        const screenTrack = screenStream.getVideoTracks()[0];
        Object.values(peersRef.current).forEach((peer) => {
          const sender = peer._pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) sender.replaceTrack(screenTrack);
        });

        myVideo.current.srcObject = screenStream;
        setIsScreenSharing(true);

        screenTrack.onended = () => {
          // Switch back to camera when screen share ends
          if (streamRef.current) {
            const videoTrack = streamRef.current.getVideoTracks()[0];
            Object.values(peersRef.current).forEach((peer) => {
              const sender = peer._pc.getSenders().find((s) => s.track?.kind === "video");
              if (sender) sender.replaceTrack(videoTrack);
            });
            myVideo.current.srcObject = streamRef.current;
            setIsScreenSharing(false);
            screenStreamRef.current = null;
          }
        };
      }
    } catch (err) {
      console.error("Screen share error:", err);
      toast.error("Failed to share screen");
    }
  };

  const sendMessage = () => {
    if (input.trim()) {
      socket.emit("chat-message", { roomId, user: socket.id, message: input });
      setMessages((prev) => [...prev, { user: "You", message: input, isMe: true }]);
      setInput("");
    }
  };

  const endCall = () => {
    if (window.confirm("Are you sure you want to end the call for everyone?")) {
      socket.emit("end-call", roomId);
      cleanup();
      navigate("/Dashboard");
    }
  };

  const leaveCall = () => {
    if (window.confirm("Leave the meeting?")) {
      cleanup();
      navigate("/Dashboard");
    }
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    Object.values(peersRef.current).forEach((peer) => !peer.destroyed && peer.destroy());
    peersRef.current = {};
    setPeers([]);
    socket.disconnect();
  };

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="room-info">
          <h2>Meeting: {roomId}</h2>
          <div className="participant-count">
            <i className="fas fa-users"></i> {participants} participants
          </div>
          <div className={`connection-status ${connectionStatus}`}>
            {connectionStatus === "connected" ? "Connected" : 
             connectionStatus === "connecting" ? "Connecting..." : "Disconnected"}
          </div>
        </div>
        <div className="header-controls">
          {isHost && (
            <button onClick={endCall} className="end-call-btn">
              <i className="fas fa-phone-slash"></i> End Call
            </button>
          )}
          <button onClick={leaveCall} className="leave-call-btn">
            <i className="fas fa-sign-out-alt"></i> Leave
          </button>
        </div>
      </header>

      <div className="video-container">
        <div className="video-grid">
          <div className="video-item local-video">
            <video ref={myVideo} autoPlay muted playsInline />
            <div className="video-overlay">
              <span>You {isMuted ? " (Muted)" : ""} {isCameraOff ? " (Camera Off)" : ""}</span>
            </div>
          </div>
          {peers.map(({ peerId, peer }) => (
            <Video key={peerId} peer={peer} peerId={peerId} />
          ))}
        </div>

        <div className="controls">
          <button onClick={toggleMute} className={`control-btn ${isMuted ? 'active' : ''}`}>
            <i className={`fas ${isMuted ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <button onClick={toggleCamera} className={`control-btn ${isCameraOff ? 'active' : ''}`}>
            <i className={`fas ${isCameraOff ? 'fa-video-slash' : 'fa-video'}`}></i>
            {isCameraOff ? 'Camera On' : 'Camera Off'}
          </button>
          <button onClick={startScreenShare} className={`control-btn ${isScreenSharing ? 'active' : ''}`}>
            <i className="fas fa-desktop"></i>
            {isScreenSharing ? 'Stop Share' : 'Share Screen'}
          </button>
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-header">
          <h3>Chat</h3>
          <div className="chat-indicator">{messages.length} messages</div>
        </div>
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.isMe ? 'my-message' : 'their-message'}`}>
              <div className="message-sender">{msg.user}</div>
              <div className="message-content">{msg.message}</div>
            </div>
          ))}
        </div>
        <div className="chat-input-container">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            className="chat-input"
          />
          <button onClick={sendMessage} className="send-message-btn">
            <i className="fas fa-paper-plane"></i>
          </button>
        </div>
      </div>
    </div>
  );
}

function Video({ peer, peerId }) {
  const ref = useRef();
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const handleStream = (stream) => {
      if (ref.current && stream) {
        ref.current.srcObject = stream;
        setHasVideo(stream.getVideoTracks().length > 0);
        
        // Force play the video
        ref.current.play().catch(err => {
          console.warn("Remote video autoplay prevented:", err);
        });
        
        // Check if video tracks are enabled
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          videoTracks[0].onended = () => {
            setHasVideo(false);
          };
        }
      }
    };
    
    // Check if peer already has a stream
    if (peer.stream) {
      handleStream(peer.stream);
    }
    
    peer.on("stream", handleStream);
    
    return () => {
      peer.removeListener("stream", handleStream);
    };
  }, [peer]);

  return (
    <div className="video-item">
      <video 
        ref={ref} 
        autoPlay 
        playsInline 
        muted={false}
        onLoadedMetadata={() => {
          // Force play in case autoplay is blocked
          if (ref.current) {
            ref.current.play().catch(console.error);
          }
        }}
      />
      <div className="video-overlay">
        <span>User {peerId.substring(0, 8)}</span>
        {!hasVideo && <div className="no-video-indicator">No video</div>}
      </div>
    </div>
  );
}