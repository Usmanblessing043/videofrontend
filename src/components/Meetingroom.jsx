import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from 'react-toastify';
import io from "socket.io-client";
import Peer from "simple-peer";
import './RoomMeeting.css';

// Create a custom hook for socket connection
const useSocket = (url) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    const handleConnect = () => {
      console.log("Connected to server:", newSocket.id);
      setIsConnected(true);
    };

    const handleConnectError = (err) => {
      console.error("Connection error:", err);
      setIsConnected(false);
    };

    const handleDisconnect = (reason) => {
      console.log("Disconnected from server:", reason);
      setIsConnected(false);
    };

    newSocket.on("connect", handleConnect);
    newSocket.on("connect_error", handleConnectError);
    newSocket.on("disconnect", handleDisconnect);

    setSocket(newSocket);

    return () => {
      newSocket.off("connect", handleConnect);
      newSocket.off("connect_error", handleConnectError);
      newSocket.off("disconnect", handleDisconnect);
      newSocket.close();
    };
  }, [url]);

  return { socket, isConnected };
};

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL || "http://localhost:3022";
  const { socket, isConnected } = useSocket(`${backendUrl}/user`);

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
  const [participants, setParticipants] = useState(1);
  const [mediaError, setMediaError] = useState(false);
  const [joinedRoom, setJoinedRoom] = useState(false);

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
    iceCandidatePoolSize: 10
  };

  useEffect(() => {
    let mounted = true;

    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 640, height: 480 }, // Reduced resolution for better performance
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
          // Try again with user gesture
          const playButton = document.createElement('button');
          playButton.innerHTML = 'Play Video';
          playButton.style.position = 'absolute';
          playButton.style.top = '10px';
          playButton.style.left = '10px';
          playButton.style.zIndex = '100';
          playButton.onclick = () => {
            myVideo.current.play();
            playButton.remove();
          };
          document.querySelector('.local-video').appendChild(playButton);
        });

        setMediaError(false);
      } catch (err) {
        console.error("Error accessing media devices:", err);
        toast.error("Could not access camera/microphone. Please check permissions.");
        setMediaError(true);
      }
    };

    getMedia();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!socket || !streamRef.current) return;

    const handleHost = () => {
      console.log("I am the host");
      setIsHost(true);
    };

    const handleAllUsers = (users) => {
      console.log("All users in room:", users);
      setParticipants(users.length + 1);
      
      // Create peers for all existing users
      users.forEach((userId) => {
        if (!peersRef.current[userId] && userId !== socket.id) {
          console.log("Creating peer for user:", userId);
          const peer = createPeer(userId, socket.id, streamRef.current);
          peersRef.current[userId] = peer;
          setPeers((prev) => [...prev, { peerId: userId, peer }]);
        }
      });
    };

    const handleUserJoined = (newUserId) => {
      console.log("🆕 User joined:", newUserId);
      setParticipants(prev => prev + 1);
      
      // Only create peer if we're the host to avoid duplicate connections
      if (isHost && !peersRef.current[newUserId] && newUserId !== socket.id) {
        console.log("Creating peer for new user:", newUserId);
        const peer = createPeer(newUserId, socket.id, streamRef.current);
        peersRef.current[newUserId] = peer;
        setPeers((prev) => [...prev, { peerId: newUserId, peer }]);
      }
    };

    const handleReceivingSignal = ({ signal, callerId }) => {
      console.log("📡 Receiving signal from:", callerId);
      
      // Only respond to signals if we're not the host (to avoid duplicate connections)
      if (!isHost && !peersRef.current[callerId] && callerId !== socket.id) {
        console.log("Adding peer for caller:", callerId);
        const peer = addPeer(signal, callerId, streamRef.current);
        peersRef.current[callerId] = peer;
        setPeers((prev) => [...prev, { peerId: callerId, peer }]);
      } else if (peersRef.current[callerId]) {
        console.log("Signaling existing peer:", callerId);
        peersRef.current[callerId].signal(signal);
      }
    };

    const handleReceivingReturnedSignal = ({ signal, id }) => {
      console.log("📡 Receiving returned signal from:", id);
      const peer = peersRef.current[id];
      if (peer) {
        peer.signal(signal);
      } else {
        console.warn("Peer not found for returned signal:", id);
        // Try to create a new peer if not found
        if (!isHost && streamRef.current) {
          const newPeer = addPeer(signal, id, streamRef.current);
          peersRef.current[id] = newPeer;
          setPeers((prev) => [...prev, { peerId: id, peer: newPeer }]);
        }
      }
    };

    const handleUserLeft = (id) => {
      console.log("User left:", id);
      setParticipants(prev => prev - 1);
      const peer = peersRef.current[id];
      if (peer) {
        peer.destroy();
        delete peersRef.current[id];
      }
      setPeers(users => users.filter(p => p.peerId !== id));
      toast.info(`Participant left the meeting`);
    };

    const handleChatMessage = ({ user, message }) => {
      setMessages((prev) => [...prev, { user, message }]);
    };

    const handleEndCall = () => {
      toast.success("Meeting has ended by host");
      cleanup();
      navigate("/Dashboard");
    };

    // Add event listeners
    socket.on("host", handleHost);
    socket.on("all-users", handleAllUsers);
    socket.on("user-joined", handleUserJoined);
    socket.on("receiving-signal", handleReceivingSignal);
    socket.on("receiving-returned-signal", handleReceivingReturnedSignal);
    socket.on("user-left", handleUserLeft);
    socket.on("chat-message", handleChatMessage);
    socket.on("end-call", handleEndCall);

    // Join room when socket is connected and we have media
    if (isConnected && !joinedRoom && streamRef.current) {
      socket.emit("join-room", roomId);
      setJoinedRoom(true);
      console.log("Joined room:", roomId);
    }

    return () => {
      // Remove event listeners
      socket.off("host", handleHost);
      socket.off("all-users", handleAllUsers);
      socket.off("user-joined", handleUserJoined);
      socket.off("receiving-signal", handleReceivingSignal);
      socket.off("receiving-returned-signal", handleReceivingReturnedSignal);
      socket.off("user-left", handleUserLeft);
      socket.off("chat-message", handleChatMessage);
      socket.off("end-call", handleEndCall);
    };
  }, [socket, isConnected, roomId, isHost, navigate, joinedRoom]);

  // Caller (initiator) - Only hosts should call this
  const createPeer = (userToSignal, callerId, stream) => {
    console.log("Creating peer as initiator for:", userToSignal);
    
    const peer = new Peer({
      initiator: true,
      trickle: true, // Enable trickle ICE for faster connection
      stream,
      config: iceConfig,
    });

    peer.on("signal", (signal) => {
      console.log("Caller signaling to:", userToSignal);
      if (socket && socket.connected) {
        socket.emit("sending-signal", { userToSignal, callerId, signal });
      } else {
        console.error("Cannot send signal - socket not connected");
      }
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
  };

  // Callee (answerer) - Only non-hosts should call this
  const addPeer = (incomingSignal, callerId, stream) => {
    console.log("Adding peer as answerer for:", callerId);
    
    const peer = new Peer({
      initiator: false,
      trickle: true,
      stream,
      config: iceConfig,
    });

    peer.on("signal", (signal) => {
      console.log("Callee returning signal to:", callerId);
      if (socket && socket.connected) {
        socket.emit("returning-signal", { signal, id: socket.id });
      } else {
        console.error("Cannot return signal - socket not connected");
      }
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
      }, 1000);
    }

    return peer;
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].enabled = !audioTracks[0].enabled;
        setIsMuted(!audioTracks[0].enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks[0].enabled = !videoTracks[0].enabled;
        setIsCameraOff(!videoTracks[0].enabled);
      }
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
    if (input.trim() && socket && socket.connected) {
      socket.emit("chat-message", { roomId, user: socket.id, message: input });
      setMessages((prev) => [...prev, { user: "You", message: input, isMe: true }]);
      setInput("");
    } else if (!socket || !socket.connected) {
      toast.error("Cannot send message - not connected to server");
    }
  };

  const endCall = () => {
    if (window.confirm("Are you sure you want to end the call for everyone?")) {
      if (socket && socket.connected) {
        socket.emit("end-call", roomId);
      }
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

  const reconnect = () => {
    if (socket && !socket.connected) {
      socket.connect();
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
  };

  if (mediaError) {
    return (
      <div className="error-container">
        <div className="error-content">
          <h2>Camera/Microphone Access Required</h2>
          <p>Please allow access to your camera and microphone to join the meeting.</p>
          <button onClick={() => window.location.reload()} className="retry-btn">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="room-info">
          <h2>Meeting: {roomId}</h2>
          <div className="participant-count">
            <i className="fas fa-users"></i> {participants} participants
          </div>
          <div className="connection-info">
            <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? "Connected" : "Disconnected"}
            </div>
            {isHost && <div className="host-indicator">Host</div>}
          </div>
        </div>
        <div className="header-controls">
          {!isConnected && (
            <button onClick={reconnect} className="reconnect-btn">
              <i className="fas fa-sync-alt"></i> Reconnect
            </button>
          )}
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
              {isHost && <span className="host-badge">Host</span>}
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
            disabled={!isConnected}
          />
          <button onClick={sendMessage} className="send-message-btn" disabled={!isConnected}>
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
  const [isLoading, setIsLoading] = useState(true);
  const [connectionState, setConnectionState] = useState("connecting");

  useEffect(() => {
    const handleStream = (stream) => {
      if (ref.current && stream) {
        ref.current.srcObject = stream;
        setHasVideo(stream.getVideoTracks().length > 0);
        setIsLoading(false);
        setConnectionState("connected");
        
        // Force play the video
        ref.current.play().catch(err => {
          console.warn("Remote video autoplay prevented:", err);
        });
      }
    };
    
    const handleConnect = () => {
      console.log("Peer connected:", peerId);
      setConnectionState("connected");
      setIsLoading(false);
    };
    
    const handleError = (err) => {
      console.error("Peer error:", err);
      setConnectionState("failed");
    };
    
    const handleClose = () => {
      console.log("Peer connection closed:", peerId);
      setConnectionState("disconnected");
    };

    // Check if peer already has a stream
    if (peer.stream) {
      handleStream(peer.stream);
    }
    
    peer.on("stream", handleStream);
    peer.on("connect", handleConnect);
    peer.on("error", handleError);
    peer.on("close", handleClose);
    
    // Check connection state periodically
    const interval = setInterval(() => {
      if (peer._pc) {
        const state = peer._pc.connectionState;
        setConnectionState(state);
        
        if (state === "connected" && isLoading) {
          setIsLoading(false);
        }
        
        // If stuck for too long, try to reconnect
        if (state === "connecting" && isLoading) {
          console.log("Peer is still connecting:", peerId);
        }
      }
    }, 1000);
    
    return () => {
      peer.removeListener("stream", handleStream);
      peer.removeListener("connect", handleConnect);
      peer.removeListener("error", handleError);
      peer.removeListener("close", handleClose);
      clearInterval(interval);
    };
  }, [peer, peerId, isLoading]);

  // Show different status based on connection state
  const getStatusText = () => {
    if (isLoading) {
      switch (connectionState) {
        case "connecting": return "Connecting...";
        case "checking": return "Checking...";
        case "connected": return "Loading...";
        case "disconnected": return "Disconnected";
        case "failed": return "Connection Failed";
        default: return "Connecting...";
      }
    }
    return "";
  };

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
      {isLoading && (
        <div className="video-loading">
          <i className="fas fa-spinner fa-spin"></i>
          <span>{getStatusText()}</span>
        </div>
      )}
      <div className="video-overlay">
        <span>User {peerId.substring(0, 8)}</span>
        <div className={`connection-dot ${connectionState}`} title={connectionState}></div>
        {!hasVideo && !isLoading && <div className="no-video-indicator">No video</div>}
      </div>
    </div>
  );
}