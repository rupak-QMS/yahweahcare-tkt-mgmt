// Mock pg pool — prevents any real DB connections during tests.
// query is typed as jest.Mock<Promise<any>, any[]> so mockResolvedValueOnce
// accepts any value without TypeScript complaining about 'never'.
export const pool = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: jest.fn<Promise<any>, any[]>(),
  on:      jest.fn(),
  connect: jest.fn(),
  end:     jest.fn(),
};
