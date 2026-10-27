"use client";

import {
  memo,
  useState,
  useEffect,
  useCallback,
  useRef,
  type PropsWithChildren,
} from "react";
import { createPortal } from "react-dom";
import { cva, type VariantProps } from "class-variance-authority";
import {
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  ImageOffIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import type {
  ImageMessagePart,
  ImageMessagePartComponent,
} from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { hostOf, safeHref } from "./href";

const extensionForMimeType = (mimeType?: string): string => {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
};

const dataUriToBlob = (dataUri: string): Blob | null => {
  const commaIndex = dataUri.indexOf(",");
  const meta = commaIndex >= 0 ? dataUri.slice(0, commaIndex) : dataUri;
  const data = commaIndex >= 0 ? dataUri.slice(commaIndex + 1) : "";
  const mime =
    meta.match(/data:([^;]+)/i)?.[1]?.toLowerCase() ??
    "application/octet-stream";
  if (!/;base64/i.test(meta)) {
    const parts: BlobPart[] = [];
    let last = 0;
    for (const match of data.matchAll(/(?:%[\da-f]{2})+/gi)) {
      if (match.index > last) parts.push(data.slice(last, match.index));
      const run = match[0];
      const escaped = new Uint8Array(run.length / 3);
      for (let index = 0; index < escaped.length; index++) {
        escaped[index] = Number.parseInt(
          run.slice(index * 3 + 1, index * 3 + 3),
          16,
        );
      }
      parts.push(escaped);
      last = match.index + run.length;
    }
    parts.push(data.slice(last));
    return new Blob(parts, { type: mime });
  }
  let bytes: string;
  try {
    const base64 = data.replace(/%([\da-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    bytes = atob(base64);
  } catch {
    return null;
  }
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
};

const mimeFromImage = (image: string): string | undefined =>
  image.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase();

const defaultFilenameFromImage = (image: string): string => {
  const mime = mimeFromImage(image);
  if (mime) return `image.${extensionForMimeType(mime)}`;
  try {
    const path = new URL(image, document.baseURI).pathname;
    const encodedBasename = path.split("/").pop() ?? "";
    let basename = encodedBasename;
    try {
      basename = decodeURIComponent(encodedBasename);
    } catch {}
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(basename)) return basename;
  } catch {}
  return "image.png";
};

const safeImageDownloadHref = (image: string): string | null => {
  try {
    const url = new URL(image, document.baseURI);
    return url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "blob:"
      ? image
      : null;
  } catch {
    return null;
  }
};

const downloadImagePart = (
  part: Pick<ImageMessagePart, "image" | "filename">,
): void => {
  if (typeof document === "undefined") return;
  const filename = part.filename ?? defaultFilenameFromImage(part.image);
  const isDataUri = /^data:/i.test(part.image);
  const blob = isDataUri ? dataUriToBlob(part.image) : null;
  if (isDataUri && !blob) return;
  const objectUrl = blob ? URL.createObjectURL(blob) : null;
  const href = objectUrl ?? safeImageDownloadHref(part.image);
  if (!href) return;
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 40_000);
};

const copyImagePart = async (
  part: Pick<ImageMessagePart, "image">,
): Promise<void> => {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error("Clipboard API is not available in this environment.");
  }
  const blob = /^data:/i.test(part.image)
    ? dataUriToBlob(part.image)
    : await fetch(part.image).then((r) => r.blob());
  if (!blob) return;
  const mime = mimeFromImage(part.image) ?? blob.type ?? "image/png";
  await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
};

const imageVariants = cva(
  "tw:aui-image-root tw:relative tw:overflow-hidden tw:rounded-lg",
  {
    variants: {
      variant: {
        outline: "tw:border-border tw:border",
        ghost: "tw:",
        muted: "tw:bg-muted/50",
      },
      size: {
        sm: "tw:max-w-64",
        default: "tw:max-w-96",
        lg: "tw:max-w-[512px]",
        full: "tw:w-full",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

export type ImageRootProps = React.ComponentProps<"div"> &
  VariantProps<typeof imageVariants>;

function ImageRoot({
  className,
  variant,
  size,
  children,
  ...props
}: ImageRootProps) {
  return (
    <div
      data-slot="image-root"
      data-variant={variant}
      data-size={size}
      className={cn(imageVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  );
}

type ImagePreviewProps = Omit<React.ComponentProps<"img">, "children"> & {
  containerClassName?: string | undefined;
  ratio?: "auto" | "1:1" | "4:3" | "16:9" | "9:16" | undefined;
  fit?: "cover" | "contain" | undefined;
};

function ImagePreview({
  className,
  containerClassName,
  ratio = "auto",
  fit = "contain",
  onLoad,
  onError,
  alt = "Image content",
  src,
  ...props
}: ImagePreviewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [errorSrc, setErrorSrc] = useState<string | undefined>(undefined);

  const loaded = loadedSrc === src;
  const error = errorSrc === src;
  const fixedRatio = ratio !== "auto";
  const ratioClassName =
    ratio === "1:1"
      ? "aspect-square"
      : ratio === "4:3"
        ? "aspect-[4/3]"
        : ratio === "16:9"
          ? "aspect-video"
          : ratio === "9:16"
            ? "aspect-[9/16]"
            : undefined;

  useEffect(() => {
    const image = imgRef.current;
    if (typeof src !== "string" || !image?.complete) return;
    if (image.naturalWidth > 0) setLoadedSrc(src);
    else setErrorSrc(src);
  }, [src]);

  return (
    <div
      data-slot="image-preview"
      className={cn(
        "tw:relative",
        fixedRatio ? ratioClassName : "tw:min-h-32",
        containerClassName,
      )}
    >
      {!loaded && !error && (
        <div
          data-slot="image-preview-loading"
          className="tw:bg-muted/50 tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center"
        >
          <ImageIcon className="tw:text-muted-foreground tw:size-8 tw:animate-pulse" />
        </div>
      )}
      {error ? (
        <div
          data-slot="image-preview-error"
          className={cn(
            "tw:bg-muted/50 tw:flex tw:min-h-32 tw:items-center tw:justify-center tw:p-4",
            fixedRatio && "tw:absolute tw:inset-0",
          )}
        >
          <ImageOffIcon className="tw:text-muted-foreground tw:size-8" />
        </div>
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className={cn(
            fixedRatio
              ? cn("block h-full w-full", {
                  "object-cover": fit === "cover",
                  "object-contain": fit === "contain",
                })
              : "tw:block tw:h-auto tw:w-full tw:object-contain",
            !loaded && "tw:invisible",
            className,
          )}
          onLoad={(e) => {
            if (typeof src === "string") setLoadedSrc(src);
            onLoad?.(e);
          }}
          onError={(e) => {
            if (typeof src === "string") setErrorSrc(src);
            onError?.(e);
          }}
          {...props}
        />
      )}
    </div>
  );
}

export type ImageSourceProps = {
  label?: string | undefined;
  url?: string | undefined;
  iconUrl?: string | undefined;
} & React.ComponentProps<"div">;

function ImageSource({
  className,
  label,
  url,
  iconUrl,
  ...props
}: ImageSourceProps) {
  const href = safeHref(url);
  const host = hostOf(url);
  const displayLabel = label || host;
  const [failedIconUrl, setFailedIconUrl] = useState<string | undefined>();

  if (!displayLabel) return null;

  const showIcon = iconUrl !== undefined && failedIconUrl !== iconUrl;

  return (
    <div
      data-slot="image-source"
      className={cn(
        "tw:text-muted-foreground tw:flex tw:items-center tw:gap-2 tw:border-t tw:px-2 tw:py-1.5 tw:text-xs",
        className,
      )}
      {...props}
    >
      {showIcon ? (
        <img
          data-slot="image-source-icon"
          src={iconUrl}
          alt=""
          className="tw:size-4 tw:shrink-0 tw:rounded-sm"
          onError={() => setFailedIconUrl(iconUrl)}
        />
      ) : (
        <span
          data-slot="image-source-icon-fallback"
          aria-hidden="true"
          className="tw:bg-muted tw:flex tw:size-4 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-sm tw:text-[10px] tw:font-medium"
        >
          {displayLabel.charAt(0).toUpperCase()}
        </span>
      )}
      {href ? (
        <a
          data-slot="image-source-label"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="tw:hover:text-foreground tw:truncate"
        >
          {displayLabel}
          <span className="tw:sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span data-slot="image-source-label" className="tw:truncate">
          {displayLabel}
        </span>
      )}
    </div>
  );
}

function ImageFilename({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  if (!children) return null;

  return (
    <span
      data-slot="image-filename"
      className={cn(
        "tw:text-muted-foreground tw:block tw:truncate tw:px-2 tw:py-1.5 tw:text-xs",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

type ImageZoomProps = PropsWithChildren<{
  src: string;
  alt?: string;
}>;

function ImageZoom({ src, alt = "Image preview", children }: ImageZoomProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = overlayRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables?.[0];
      const last = focusables?.[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.click();
          } else if (e.key === " ") {
            e.preventDefault();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " ") e.currentTarget.click();
        }}
        role="button"
        tabIndex={0}
        className="tw:aui-image-zoom-trigger tw:cursor-zoom-in"
        aria-label="Click to zoom image"
      >
        {children}
      </div>
      {isOpen &&
        createPortal(
          <div
            ref={overlayRef}
            data-slot="image-zoom-overlay"
            role="dialog"
            aria-modal="true"
            className="tw:aui-image-zoom-overlay tw:fade-in tw:animate-in tw:fixed tw:inset-0 tw:z-50 tw:flex tw:items-center tw:justify-center tw:bg-black/80 tw:duration-200"
            onClick={handleClose}
            aria-label="Zoomed image"
          >
            <img
              data-slot="image-zoom-content"
              src={src}
              alt={alt}
              className="tw:aui-image-zoom-content tw:fade-in tw:zoom-in-95 tw:animate-in tw:max-h-[90%] tw:max-w-[90%] tw:cursor-zoom-out tw:object-contain tw:duration-200"
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
            />
            <button
              ref={closeRef}
              type="button"
              aria-label="Close zoomed image"
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="tw:text-muted-foreground tw:hover:text-foreground tw:bg-background/80 tw:absolute tw:end-4 tw:top-4 tw:cursor-pointer tw:rounded-md tw:p-2"
            >
              <XIcon className="tw:size-5" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

function ImageGenerating({ className }: { className?: string }) {
  return (
    <div
      data-slot="image-generating"
      className={cn(
        "tw:bg-muted/50 tw:flex tw:min-h-32 tw:items-center tw:justify-center tw:p-4",
        className,
      )}
    >
      <Loader2Icon className="tw:text-muted-foreground tw:size-8 tw:animate-spin" />
      <span className="tw:sr-only">Generating image…</span>
    </div>
  );
}

function ImageContentFilterError({
  className,
  reason,
}: {
  className?: string;
  reason?: string;
}) {
  return (
    <div
      data-slot="image-content-filter-error"
      className={cn(
        "tw:bg-muted/50 tw:flex tw:min-h-32 tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:p-4 tw:text-center",
        className,
      )}
    >
      <ShieldAlertIcon className="tw:text-muted-foreground tw:size-8" />
      <p className="tw:text-sm tw:font-medium">Image could not be generated</p>
      {reason && <p className="tw:text-muted-foreground tw:text-xs">{reason}</p>}
    </div>
  );
}

export type ImageActionsProps = {
  part: ImageMessagePart;
  /**
   * Wire to your own generation call to show a regenerate button. The button
   * renders only when this is set and the part carries a `prompt`.
   */
  onRegenerate?: () => void | Promise<void>;
  className?: string;
};

function RegenerateButton({
  onRegenerate,
}: {
  onRegenerate: () => void | Promise<void>;
}) {
  const [isRegenerating, setIsRegenerating] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setIsRegenerating(true);
        try {
          await onRegenerate();
        } catch {
        } finally {
          setIsRegenerating(false);
        }
      }}
      disabled={isRegenerating}
      data-slot="image-regenerate"
      aria-label="Regenerate image"
      className="tw:hover:bg-muted tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded tw:disabled:opacity-50"
    >
      <RefreshCwIcon
        className={cn("tw:size-4", isRegenerating && "tw:animate-spin")}
      />
    </button>
  );
}

function ImageActions({ part, onRegenerate, className }: ImageActionsProps) {
  return (
    <div
      data-slot="image-actions"
      className={cn("tw:flex tw:items-center tw:gap-1 tw:p-1", className)}
    >
      <button
        type="button"
        onClick={() => downloadImagePart(part)}
        data-slot="image-download"
        aria-label="Download image"
        className="tw:hover:bg-muted tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded"
      >
        <DownloadIcon className="tw:size-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          copyImagePart(part).catch(() => {});
        }}
        data-slot="image-copy"
        aria-label="Copy image"
        className="tw:hover:bg-muted tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded"
      >
        <CopyIcon className="tw:size-4" />
      </button>
      {onRegenerate && <RegenerateButton onRegenerate={onRegenerate} />}
    </div>
  );
}

const ImageImpl: ImageMessagePartComponent = (props) => {
  const { image, filename, status } = props;

  if (status?.type === "running") {
    return (
      <ImageRoot>
        <ImageGenerating />
        <ImageFilename>{filename}</ImageFilename>
      </ImageRoot>
    );
  }

  if (status?.type === "incomplete" && status.reason === "content-filter") {
    return (
      <ImageRoot>
        <ImageContentFilterError reason="The provider blocked this image." />
      </ImageRoot>
    );
  }

  return (
    <ImageRoot>
      <ImageZoom src={image} alt={filename || "Image content"}>
        <ImagePreview src={image} alt={filename || "Image content"} />
      </ImageZoom>
      <ImageFilename>{filename}</ImageFilename>
    </ImageRoot>
  );
};

const Image = memo(ImageImpl) as unknown as ImageMessagePartComponent & {
  Root: typeof ImageRoot;
  Preview: typeof ImagePreview;
  Source: typeof ImageSource;
  Filename: typeof ImageFilename;
  Zoom: typeof ImageZoom;
  Actions: typeof ImageActions;
  Generating: typeof ImageGenerating;
  ContentFilterError: typeof ImageContentFilterError;
};

Image.displayName = "Image";
Image.Root = ImageRoot;
Image.Preview = ImagePreview;
Image.Source = ImageSource;
Image.Filename = ImageFilename;
Image.Zoom = ImageZoom;
Image.Actions = ImageActions;
Image.Generating = ImageGenerating;
Image.ContentFilterError = ImageContentFilterError;

export {
  Image,
  ImageRoot,
  ImagePreview,
  ImageSource,
  ImageFilename,
  ImageZoom,
  ImageActions,
  ImageGenerating,
  ImageContentFilterError,
  imageVariants,
};
