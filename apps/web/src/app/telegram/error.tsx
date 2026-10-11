"use client";
export default function ErrorPage({ reset }: { reset(): void }) { return <div className="mini-screen"><section className="mini-panel mini-empty"><h1>Something went wrong</h1><p>We couldn’t open this screen. Please try again.</p><button className="mini-primary" onClick={reset}>Try again</button></section></div>; }
