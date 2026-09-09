"use client";

export default function Page() {
  const checkout = async () => {
    const res = await fetch('/api/create-payment', { method: 'POST' });
    const data = await res.json();
    window.location.href = data.url;
  };
  return (
    <div>
      <h1>Product</h1>
      <button onClick={checkout}>Pay with FurlPay</button>
    </div>
  );
}
