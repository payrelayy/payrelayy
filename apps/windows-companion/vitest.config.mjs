export default {
  test: {
    // Hosted Windows runners can stall the first DPAPI PowerShell process when
    // it competes with the real Chrome integration suites. Keep those
    // platform-bound tests isolated without slowing the ordinary Linux suite.
    fileParallelism: process.platform !== 'win32',
  },
};
