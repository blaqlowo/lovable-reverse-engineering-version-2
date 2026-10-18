// sse.ts
// Reads a Server-Sent Events stream that arrives in arbitrary chunks.

// Returns a function you feed raw text chunks into. onData fires once per complete event.
export function createSseParser(onData: (data: string) => void) {
  let buf = "";
  return (chunk: string) => {
    buf = (buf + chunk).replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) onData(data); // comment lines such as ": ping" carry no data
    }
  };
}
