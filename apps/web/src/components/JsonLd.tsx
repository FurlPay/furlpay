// Emits one or more JSON-LD graphs into the page. Server component — the
// <script> is part of the initial HTML so crawlers and AI models read it
// without executing JS. Pass a single object or an array.
//
// Security: JSON.stringify alone doesn't escape `<`, so a crafted value
// containing `</script>` could break out of the tag. The \u003c replacement
// neutralises this without affecting JSON validity.
export default function JsonLd({ data }: { data: object | object[] }) {
  const graphs = Array.isArray(data) ? data : [data];
  return (
    <>
      {graphs.map((g, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(g).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
