// Loads a third-party script once; only ever called after the user connects.
const loading = new Map<string, Promise<void>>();
export function loadScript(src: string, doc: Document = document): Promise<void> {
  const known = loading.get(src);
  if (known) return known;
  const promise = new Promise<void>((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      reject(new Error(`Could not load ${src}`));
    };
    doc.head.append(script);
  });
  loading.set(src, promise);
  return promise;
}
