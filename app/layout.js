import './globals.css';

export const metadata = {
  title: 'Working Calendar',
  description: 'Fetch từ Google Sheet → .ics cho iPhone'
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body style={{margin:0,fontFamily:"system-ui"}}>
        {children}
      </body>
    </html>
  );
}
