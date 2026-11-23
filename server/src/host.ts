// Your Space answers only to the address it is set up for (contracts/http-api.md, "Host Check").
// The API and the access gate both give a request that names another address this answer.

/** The answer to a request that named another address than Your Space's, saying what to fix. */
export function wrongHost(publicOrigin: string): { error: "wrong_host"; message: string } {
  return {
    error: "wrong_host",
    message: `Your Space is set up for ${publicOrigin}, and this request named a different address. If you use your own proxy, set it to pass the original Host header (nginx: proxy_set_header Host $http_host).`,
  };
}
