export const metadata = { title: 'Working Calendar', description: 'From Google Sheet → Web → ICS' };

export default function RootLayout({ children }) {
    return (
        <html lang="vi">
        <body>
        {children}
        </body>
        </html>
    );
}