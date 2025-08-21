import { Navigate, Route, Routes } from 'react-router-dom';
import Login from './components/Login';
import './App.css';
import Signup from './components/Signup';
import { ToastContainer } from 'react-toastify';
import Dashboard from './components/Dashboard';
import Meetingroom from './components/Meetingroom';
import process from "process";
window.process = process;



function App() {
  return (
   <div>
    <Routes>
      <Route path='/' element={<Navigate to="/Signup" />}></Route>
      <Route path='/Signup' element={<Signup></Signup>}></Route>
      <Route path='/Login' element={<Login></Login>}></Route>
      <Route path='/Dashboard' element={<Dashboard></Dashboard>}></Route>
      <Route path="/Meetingroom/:roomId" element={<Meetingroom/>} />
    </Routes>
     <ToastContainer></ToastContainer>

   </div>
    
  );
}

export default App;
