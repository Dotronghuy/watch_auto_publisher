import React from 'react';

export const Facebook = ({ size = 24, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 36 36" className={className}>
    <defs>
      <linearGradient id="fb_grad" x1="0" y1="36" x2="36" y2="0" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0062E0"/>
        <stop offset="1" stopColor="#19AFFF"/>
      </linearGradient>
    </defs>
    <path d="M15 35.8C6.5 34.3 0 26.9 0 18 0 8.1 8.1 0 18 0s18 8.1 18 18c0 8.9-6.5 16.3-15 17.8l-1-.8h-4l-1 .8z" fill="url(#fb_grad)"/>
    <path d="M25 12h-3c-1.3 0-2 .6-2 1.8V16h5l-.8 5h-4.2v15h-5.9V21h-3.1v-5h3.1v-2.8C14 8.7 16.6 6 21.6 6H25v6z" fill="#FFF"/>
  </svg>
);

export const Instagram = ({ size = 24, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 128 128" className={className}>
    <defs>
      <radialGradient id="ig_grad" cx="0.3" cy="1" r="1.2">
        <stop offset="0.1" stopColor="#fd5"/>
        <stop offset="0.3" stopColor="#f56040"/>
        <stop offset="0.6" stopColor="#e1306c"/>
        <stop offset="0.8" stopColor="#c13584"/>
        <stop offset="1" stopColor="#833ab4"/>
      </radialGradient>
    </defs>
    <rect rx="30" width="128" height="128" fill="url(#ig_grad)"/>
    <path fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" d="M38 30h52c16 0 24 8 24 24v20c0 16-8 24-24 24H38C22 98 14 90 14 74V54c0-16 8-24 24-24zm26 18a16 16 0 1 0 0 32 16 16 0 1 0 0-32z"/>
    <circle cx="94" cy="40" r="6" fill="#fff"/>
  </svg>
);

export const Linkedin = ({ size = 24, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
    <rect x="2" y="9" width="4" height="12"></rect>
    <circle cx="4" cy="4" r="2"></circle>
  </svg>
);

export const Twitter = ({ size = 24, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path>
  </svg>
);

export const Threads = ({ size = 24, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"></path>
    <path d="M12 8.5C10.5 8.5 9.5 9.5 9.5 11V13C9.5 14.5 10.5 15.5 12 15.5C13.5 15.5 14.5 14.5 14.5 13V11C14.5 9.5 13.5 8.5 12 8.5Z"></path>
    <path d="M14.5 11V13C14.5 15.5 12 17.5 9.5 17.5V17.5"></path>
  </svg>
);

export const TikTok = ({ size = 24, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"></path>
  </svg>
);
