"use client";
import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    document.title = "AiMoviez | 8SEC MADNESS";
  }, []);

  return (
    <iframe
      src="/landing.html"
      className="w-full h-screen border-0"
      style={{ height: "100vh", width: "100%", border: "none" }}
      title="AiMoviez Landing"
    ></iframe>
  );
}
