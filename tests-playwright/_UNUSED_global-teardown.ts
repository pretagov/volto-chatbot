export default async function globalTeardown() {
  console.log('Stopping test server...');

  const pid = process.env.TEST_SERVER_PID;
  if (pid) {
    try {
      process.kill(parseInt(pid), 'SIGTERM');
      console.log('Test server stopped');
    } catch (error) {
      console.error('Error stopping test server:', error);
    }
  }
}
