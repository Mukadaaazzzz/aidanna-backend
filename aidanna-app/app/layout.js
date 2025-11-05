export const metadata = {
  title: 'Aidanna AI - Story Learning API',
  description: 'AI-powered story learning platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}