import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import io from "socket.io-client";
import Peer from "simple-peer";
import "./RoomMeeting.css";

const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL || "http://localhost:3022";
const socket = io(backendUrl);

const Meetingroom = () => {
  const { roomId } = useParams();
  const [peers, setPeers] = useState([]);
  const userVideo = useRef();
  const peersRef = useRef([]);
  const videoGrid = useRef();

  useEffect(() => {
    // Get user media
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        userVideo.current.srcObject = stream;

        socket.emit("join-room", roomId, socket.id);

        socket.on("user-connected", (userId) => {
          const peer = createPeer(userId, socket.id, stream);
          peersRef.current.push({ peerID: userId, peer });
          setPeers((prevPeers) => [...prevPeers, peer]);
        });

        socket.on("user-disconnected", (userId) => {
          const peerObj = peersRef.current.find((p) => p.peerID === userId);
          if (peerObj) {
            peerObj.peer.destroy();
          }
          peersRef.current = peersRef.current.filter((p) => p.peerID !== userId);
          setPeers((prevPeers) => prevPeers.filter((p) => p !== peerObj.peer));
        });

        socket.on("signal", ({ userId, signal }) => {
          const peerObj = peersRef.current.find((p) => p.peerID === userId);
          if (peerObj) {
            peerObj.peer.signal(signal);
          }
        });
      });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  const createPeer = (userToSignal, callerID, stream) => {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socket.emit("signal", { userToSignal, callerID, signal });
    });

    peer.on("stream", (stream) => {
      addVideoStream(stream);
    });

    return peer;
  };

  const addVideoStream = (stream) => {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    videoGrid.current.appendChild(video);
  };

  return (
    <div className="room-container">
      <div className="video-grid" ref={videoGrid}>
        <video ref={userVideo} autoPlay playsInline muted />
      </div>
    </div>
  );
};

export default Meetingroom;