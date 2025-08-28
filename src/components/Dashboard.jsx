import React from 'react'
import './Dashboard.css'
import { useState, useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL;


const Dashboard = () => {
  const navigate = useNavigate()
  const token = localStorage.getItem('tokens')
  const users = JSON.parse(localStorage.getItem('current_users'))
  const name = users.username.toUpperCase()

  useEffect(() => {
    axios.get(`${backendUrl}/user/Verify`, {
      headers: {
        "Authorization": `bearer ${token}`
      }
    }).then((res) => {
      console.log(res.data.user);
      localStorage.setItem("current_users", JSON.stringify({ ...res.data.user, password: "" }))

    }).catch((err) => {
      console.log(err);
      if (err.response.data.message == "jwt expired") {
        navigate("/Login")
      }

    })
  }, [])

  const createRoom = async () => {
    const res = await axios.post(`${backendUrl}/user/createroom`);
    navigate(`/meetingroom/${res.data.roomId}`);
  };

  const joinRoom = () => {
    const id = prompt("Enter Room ID");
    navigate(`/meetingroom/${id}`);
  };
  return (
    <div className='dash'>
      <p className='na'>Welcome {name} </p>
      <div className="startjoin">
        <button onClick={createRoom}>Start Meeting</button>
        <button onClick={joinRoom}>Join Meeting</button>

      </div>

    </div>
  )
}

export default Dashboard