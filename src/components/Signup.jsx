import React from 'react'
import './Signup.css'
import bagvideo from './Background.mp4'
import { useFormik } from 'formik'
import * as yup from "yup"
import axios from 'axios'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {  toast } from 'react-toastify'
const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL;
console.log(process.env.REACT_APP_VIDEOBACKEND_URL);
console.log(backendUrl);





const Signup = () => {
    const navigate = useNavigate()
    const [loading, setloading] = useState(false)
    const formik = useFormik({
         initialValues: {
            username: '',
            email: "",
            password: ""
        },
        validationSchema: yup.object({
            username: yup.string().min(3, "Username is to short").max(15, "Username has exceed the 15 character").required("username is require"),
            email: yup.string().email("The email is invalid").required("Email is require").lowercase(),
            password: yup.string().min(6, "Password must be at least 6 character").required("Password is require")
        }),
        onSubmit: (value, {resetForm}) => {
            setloading(true)
            console.log(value);
                axios.post(`${backendUrl}/user/signup`, value)
                    .then((res) => {
                        console.log(res);
                        toast.success('Login successfull')
                        navigate("/Login")
                        resetForm()
                        setloading(false)

                    }).catch((err) => {
                        console.log(err);
                        toast.error(err.response?.data?.message || 'Sign up failed')
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
                <h1>Sign up for Video Conference</h1>
                <form action="" onSubmit={formik.handleSubmit}>
                    <div className="lab">
                        <label>Username</label>
                        <br />
                        <input onBlur={formik.handleBlur} placeholder='Username' name='username' onChange={formik.handleChange} value={formik.values.username} type="text" />
                    </div>
                    <small>{formik.touched.username && formik.errors.username}</small>
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
                    <p class="login-link">Already have an account? <Link className='link' to={"/Login"}>Login</Link></p>
                    <button disabled = {loading} type="submit">{loading ? "loading....." : 'Create account'}</button>
                </form>
            </div>

        </div>
    )
}

export default Signup