export function YouTube({
  id,
  title = "YouTube video",
  autoplay = false,
  className,
}: {
  id: string;
  title?: string;
  autoplay?: boolean;
  className?: string;
}) {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    showinfo: "0",
    iv_load_policy: "3",
    ...(autoplay ? { autoplay: "1" } : {}),
  });

  return (
    <div className={className ?? "my-6 aspect-video w-full overflow-hidden rounded-lg"}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading={autoplay ? undefined : "lazy"}
        className="h-full w-full"
      />
    </div>
  );
}
