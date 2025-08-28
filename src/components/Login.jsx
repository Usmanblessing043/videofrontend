import React from 'react'
import './Login.css'
import bagvideo from './Background.mp4'
import { useFormik } from 'formik'
import * as yup from "yup"
import axios from 'axios'
import { Link, useNavigate } from 'react-router-dom'
import {  toast } from 'react-toastify'
import { useState } from 'react'
const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL;
console.log(process.env.REACT_APP_VIDEOBACKEND_URL);




const Login = () => {
    const navigate = useNavigate()
    const [loading, setloading] = useState(false)
    const formik = useFormik({
         initialValues: {
            username: '',
            email: "",
            password: ""
        },
        validationSchema: yup.object({
           
            email: yup.string().email("The email is invalid").required("Email is require").lowercase(),
            password: yup.string().min(6, "Password must be at least 6 character").required("Password is require")
        }),
        onSubmit: (value, {resetForm}) => {
            setloading(true)
            console.log(value);
                axios.post(`${backendUrl}/user/login`, value)
                    .then((res) => {
                        console.log(res);
                        localStorage.setItem("tokens", res.data.token)
                        toast.success('Login successfull')
                        navigate('/Dashboard')
                        resetForm()
                        setloading(false)

                    }).catch((err) => {
                        console.log(err);
                        toast.error(err.response?.data?.message || "Login failed")
                        resetForm()
                        setloading(false)

                    })

            
        }
    })
    console.log(formik.errors);
    console.log(formik.touched);
    
    return (
        <div className='signup'>
            <video autoPlay loop muted playsInline className='bg-video'>
                <source src={bagvideo} type="video/mp4" />
            </video>
            <div className="signupcontainer">
                <h1>Login for Video Conference</h1>
                <br />
                <form action="" onSubmit={formik.handleSubmit}>
                   
                    <div className="lab">
                        <label>Email</label>
                        <br />
                        <input onBlur={formik.handleBlur} placeholder='Email' name='email' onChange={formik.handleChange} value={formik.values.email} type="email" />
                    </div>
                    <small>{formik.touched.email && formik.errors.email}</small>
                    <div className="lab">
                        <label>Password</label>
                        <br />
                        <input onBlur={formik.handleBlur} placeholder='Password' name='password' onChange={formik.handleChange} value={formik.values.password} type="password" />
                    </div>
                    <small>{formik.touched.password && formik.errors.password}</small>
                    <br />
                    <p class="login-link">Don't have an account? <Link className='link' to={"/Signup"}>Sign up</Link></p>
                    <br />
                    <button className='bbt' disabled = {loading} type="submit">{loading ? "loading...." : 'Login'}</button>
                </form>
            </div>

        </div>
    )
}

export default Login