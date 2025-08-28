// MeetingRoom.js - Updated React Component
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from 'react-toastify';
import io from "socket.io-client";
import './RoomMeeting.css';

const MeetingRoom = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  // State management
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState(new Map());
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [meetingTime, setMeetingTime] = useState(0);
  const [username, setUsername] = useState('');
  
  // Refs
  const localVideoRef = useRef(null);
  const peerConnections = useRef(new Map());
  const meetingInterval = useRef(null);
  const chatInputRef = useRef(null);
  const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL || "http://localhost:3022";

  // Initialize meeting
  useEffect(() => {
    const user = localStorage.getItem('username');
    if (user) {
      setUsername(user);
      initializeMeeting(user);
    } else {
      // Prompt for username if not set
      const name = prompt('Enter your name:');
      if (name) {
        setUsername(name);
        localStorage.setItem('username', name);
        initializeMeeting(name);
      } else {
        navigate('/');
      }
    }
    
    return () => cleanupMeeting();
  }, []);

  // Initialize media and socket connection
  const initializeMeeting = async (username) => {
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Connect to socket server
      const token = localStorage.getItem('token') || 'demo-token';
      const newSocket = io(backendUrl, {
        auth: { token },
        transports: ['websocket', 'polling']
      });

      newSocket.on('connect', () => {
        setIsConnected(true);
        toast.success('Connected to meeting');
        
        // Join the room
        newSocket.emit('join-room', { roomId, username });
      });

      newSocket.on('disconnect', () => {
        setIsConnected(false);
        toast.error('Disconnected from meeting');
      });

      newSocket.on('user-joined', handleUserJoined);
      newSocket.on('user-left', handleUserLeft);
      newSocket.on('signal', handleSignal);
      newSocket.on('receive-message', handleReceiveMessage);
      newSocket.on('meeting-ended', handleMeetingEnded);
      newSocket.on('incoming-call', handleIncomingCall);

      setSocket(newSocket);
      startMeetingTimer();

    } catch (error) {
      console.error('Error initializing meeting:', error);
      toast.error('Failed to initialize meeting');
    }
  };

  // Cleanup on unmount
  const cleanupMeeting = () => {
    if (socket) {
      socket.emit('leave-room', { roomId });
      socket.disconnect();
    }
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    
    if (meetingInterval.current) {
      clearInterval(meetingInterval.current);
    }
  };

  // Start meeting timer
  const startMeetingTimer = () => {
    const startTime = Date.now();
    meetingInterval.current = setInterval(() => {
      setMeetingTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  };

  // Format meeting time
  const formatMeetingTime = () => {
    const hours = Math.floor(meetingTime / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((meetingTime % 3600) / 60).toString().padStart(2, '0');
    const seconds = (meetingTime % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  // Handle user joining
  const handleUserJoined = async ({ socketId, userId, username }) => {
    try {
      // Don't create peer connection for self
      if (socketId === socket.id) return;
      
      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Add local stream to peer connection
      if (localStream) {
        localStream.getTracks().forEach(track => {
          pc.addTrack(track, localStream);
        });
      }

      // Handle remote stream
      pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        setRemoteStreams(prev => new Map(prev.set(socketId, remoteStream)));
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('signal', {
            roomId,
            to: socketId,
            data: { type: 'ice-candidate', candidate: event.candidate }
          });
        }
      };

      // Store peer connection
      peerConnections.current.set(socketId, pc);
      
      // Update participants list
      setParticipants(prev => new Map(prev.set(socketId, { userId, username })));

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('signal', {
        roomId,
        to: socketId,
        data: { type: 'offer', offer }
      });
      
      toast.info(`${username} joined the meeting`);
    } catch (error) {
      console.error('Error handling user joined:', error);
    }
  };

  // Handle user leaving
  const handleUserLeft = ({ socketId }) => {
    const participant = participants.get(socketId);
    if (participant) {
      toast.info(`${participant.username} left the meeting`);
    }
    
    // Close peer connection
    if (peerConnections.current.has(socketId)) {
      peerConnections.current.get(socketId).close();
      peerConnections.current.delete(socketId);
    }
    
    // Remove remote stream
    setRemoteStreams(prev => {
      const newStreams = new Map(prev);
      newStreams.delete(socketId);
      return newStreams;
    });
    
    // Remove participant
    setParticipants(prev => {
      const newParticipants = new Map(prev);
      newParticipants.delete(socketId);
      return newParticipants;
    });
  };

  // Handle signaling
  const handleSignal = async ({ from, data }) => {
    try {
      if (!peerConnections.current.has(from)) {
        // Create new peer connection for incoming signal
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        });

        // Add local stream
        if (localStream) {
          localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
          });
        }

        // Handle remote stream
        pc.ontrack = (event) => {
          const remoteStream = event.streams[0];
          setRemoteStreams(prev => new Map(prev.set(from, remoteStream)));
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('signal', {
              roomId,
              to: from,
              data: { type: 'ice-candidate', candidate: event.candidate }
            });
          }
        };

        peerConnections.current.set(from, pc);
      }

      const pc = peerConnections.current.get(from);

      if (data.type === 'offer') {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('signal', {
          roomId,
          to: from,
          data: { type: 'answer', answer }
        });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(data.answer);
      } else if (data.type === 'ice-candidate') {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (error) {
      console.error('Error handling signal:', error);
    }
  };

  // Handle receiving messages
  const handleReceiveMessage = (message) => {
    setMessages(prev => [...prev, message]);
  };

  // Handle meeting ended by admin
  const handleMeetingEnded = () => {
    toast.info('Meeting ended by host');
    navigate('/');
  };

  // Handle incoming call (for future use)
  const handleIncomingCall = (data) => {
    console.log('Incoming call:', data);
    // Could show a notification to accept/reject call
  };

  // Send chat message
  const sendMessage = () => {
    const text = chatInputRef.current.value.trim();
    if (socket && text) {
      const message = {
        text,
        sender: username,
        time: new Date().toLocaleTimeString()
      };
      
      socket.emit('send-message', { roomId, message });
      chatInputRef.current.value = '';
    }
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsAudioMuted(!isAudioMuted);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  // Toggle screen share
  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true
        });
        
        // Replace video tracks in all peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        
        peerConnections.current.forEach(pc => {
          const sender = pc.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });
        
        // Handle when screen sharing stops
        videoTrack.onended = () => {
          toggleScreenShare();
        };
        
        // Update local video element
        if (localVideoRef.current) {
          const newStream = new MediaStream([videoTrack, ...localStream.getAudioTracks()]);
          localVideoRef.current.srcObject = newStream;
        }
        
        setIsScreenSharing(true);
      } else {
        // Switch back to camera
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true
        });
        
        const videoTrack = cameraStream.getVideoTracks()[0];
        
        peerConnections.current.forEach(pc => {
          const sender = pc.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });
        
        // Update local video element
        if (localVideoRef.current) {
          const newStream = new MediaStream([videoTrack, ...localStream.getAudioTracks()]);
          localVideoRef.current.srcObject = newStream;
          setLocalStream(newStream);
        }
        
        setIsScreenSharing(false);
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
    }
  };

  // Leave meeting
  const leaveMeeting = () => {
    navigate('/');
  };

  // End meeting (if admin)
  const endMeeting = () => {
    if (socket) {
      socket.emit('end-meeting', { roomId });
      navigate('/');
    }
  };

  // Copy meeting ID to clipboard
  const copyMeetingId = () => {
    navigator.clipboard.writeText(roomId);
    toast.info('Meeting ID copied to clipboard');
  };

  return (
    <div className="meeting-room">
      <div className="meeting-header">
        <div className="logo">
          <i className="fas fa-video"></i>
          <span>MeetClone</span>
        </div>
        <div className="meeting-info">
          <div className="meeting-time">{formatMeetingTime()}</div>
          <div className="meeting-id" onClick={copyMeetingId}>
            <i className="fas fa-key"></i>
            <span>{roomId}</span>
            <i className="fas fa-copy"></i>
          </div>
          <div className="connection-status">
            <i className={`fas fa-circle ${isConnected ? 'connected' : 'disconnected'}`}></i>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>

      <div className="main-container">
        <div className="video-container">
          {/* Local video */}
          <div className="participant local-participant">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <div className="participant-info">
              <span className="participant-name">You ({username})</span>
              <span className="participant-mic">
                <i className={`fas fa-microphone${isAudioMuted ? '-slash' : ''}`}></i>
              </span>
            </div>
          </div>

          {/* Remote participants */}
          {Array.from(remoteStreams.entries()).map(([socketId, stream]) => {
            const participant = participants.get(socketId);
            return (
              <div key={socketId} className="participant">
                <video
                  autoPlay
                  playsInline
                  ref={videoEl => {
                    if (videoEl) videoEl.srcObject = stream;
                  }}
                />
                <div className="participant-info">
                  <span className="participant-name">
                    {participant ? participant.username : 'Unknown'}
                  </span>
                  <span className="participant-mic">
                    <i className="fas fa-microphone"></i>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="chat-container">
          <div className="chat-header">
            <span>Chat</span>
            <span className="participant-count">
              <i className="fas fa-user"></i>
              <span>{participants.size + 1}</span>
            </span>
          </div>
          <div className="chat-messages">
            {messages.map((message, index) => (
              <div key={index} className="message">
                <div className="message-content">
                  <div className="message-sender">{message.sender}</div>
                  <div className="message-text">{message.text}</div>
                  <div className="message-time">{message.time}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="chat-input">
            <input
              type="text"
              placeholder="Send a message"
              ref={chatInputRef}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  sendMessage();
                }
              }}
            />
            <button onClick={sendMessage}>
              <i className="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
      </div>

      <div className="controls">
        <button className={`control-btn ${isAudioMuted ? 'muted' : ''}`} onClick={toggleAudio}>
          <div className="control-icon">
            <i className={`fas fa-microphone${isAudioMuted ? '-slash' : ''}`}></i>
          </div>
          <span>{isAudioMuted ? 'Unmute' : 'Mute'}</span>
        </button>
        
        <button className={`control-btn ${isVideoOff ? 'off' : ''}`} onClick={toggleVideo}>
          <div className="control-icon">
            <i className={`fas fa-video${isVideoOff ? '-slash' : ''}`}></i>
          </div>
          <span>{isVideoOff ? 'Start Video' : 'Stop Video'}</span>
        </button>
        
        <button className={`control-btn ${isScreenSharing ? 'active' : ''}`} onClick={toggleScreenShare}>
          <div className="control-icon">
            <i className="fas fa-desktop"></i>
          </div>
          <span>Share Screen</span>
        </button>
        
        <button className="control-btn end-call" onClick={leaveMeeting}>
          <div className="control-icon">
            <i className="fas fa-phone-slash"></i>
          </div>
          <span>Leave</span>
        </button>
        
        <button className="control-btn end-meeting" onClick={endMeeting}>
          <div className="control-icon">
            <i className="fas fa-times"></i>
          </div>
          <span>End Meeting</span>
        </button>
      </div>
    </div>
  );
};

export default MeetingRoom;