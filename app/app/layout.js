export const metadata = {
  title: 'ARIA Memory — Paper Trading Bot',
  description: 'Bot de trading Or/Forex avec mémoire IA et apprentissage',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
