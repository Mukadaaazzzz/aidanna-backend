export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">Aidanna AI API</h1>
      <p className="mt-4">Your API is running! 🚀</p>
      <div className="mt-6">
        <h2 className="text-xl font-semibold">Available Endpoints:</h2>
        <ul className="list-disc list-inside mt-2">
          <li>GET /api/health</li>
          <li>GET /api/modes</li>
          <li>POST /api/generate</li>
        </ul>
      </div>
    </main>
  );
}