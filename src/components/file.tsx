"use client";

import { memo, type FC } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
  BracesIcon,
  DownloadIcon,
} from "lucide-react";
import type { FileMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { AudioPlayer, VideoPlayer } from "./media-player";

const fileVariants = cva(
  "tw:aui-file-root tw:inline-flex tw:items-center tw:gap-3 tw:rounded-lg tw:transition-colors",
  {
    variants: {
      variant: {
        outline: "tw:border-border tw:hover:bg-muted/50 tw:border",
        ghost: "tw:hover:bg-muted/50",
        muted: "tw:bg-muted/50 tw:hover:bg-muted/70",
      },
      size: {
        sm: "tw:px-2.5 tw:py-1.5 tw:text-xs",
        default: "tw:px-3 tw:py-2 tw:text-sm",
        lg: "tw:px-4 tw:py-3 tw:text-base",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

function getMimeTypeIcon(mimeType: string): FC<{ className?: string }> {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) {
    return ImageIcon;
  }
  if (type === "application/pdf") {
    return FileTextIcon;
  }
  if (type === "application/json") {
    return BracesIcon;
  }
  if (type.startsWith("text/")) {
    return FileTextIcon;
  }
  if (type.startsWith("audio/")) {
    return MusicIcon;
  }
  if (type.startsWith("video/")) {
    return VideoIcon;
  }
  return FileIcon;
}

export type FileDataKind = "data-uri" | "url" | "base64" | "id";

function getFileDataKind(
  data: string,
  sourceType?: "url" | "id",
): FileDataKind {
  if (sourceType === "url" && /^data:/i.test(data)) return "data-uri";
  if (sourceType) return sourceType;
  if (/^data:/i.test(data)) return "data-uri";
  if (/^(https?:\/\/|blob:)/i.test(data)) return "url";
  return "base64";
}

function isUnsafeScheme(data: string): boolean {
  return (
    /^[a-z][a-z\d+.-]*:/i.test(data) &&
    !/^(data:|https?:\/\/|blob:)/i.test(data)
  );
}

function getFileHref(
  data: string,
  mimeType: string,
  sourceType?: "url" | "id",
): string | null {
  if (isUnsafeScheme(data)) return null;
  const kind = getFileDataKind(data, sourceType);
  if (kind === "id") return null;
  if (kind === "data-uri") return /^data:[^,]*,/i.test(data) ? data : null;
  if (kind === "url") return /^(https?:\/\/|blob:)/i.test(data) ? data : null;
  return `data:${mimeType};base64,${data}`;
}

function getBase64PayloadSize(payload: string): number {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const firstNonBase64 = payload.search(/[^A-Za-z\d+/]/);
  if (
    (firstNonBase64 !== -1 && firstNonBase64 !== payload.length - padding) ||
    payload.length % 4 === 1 ||
    (padding > 0 && payload.length % 4 !== 0)
  ) {
    return 0;
  }
  return Math.floor((payload.length * 3) / 4) - padding;
}

function getBase64Size(base64: string): number {
  const payload = /[\t\n\f\r ]/.test(base64)
    ? base64.replace(/[\t\n\f\r ]/g, "")
    : base64;
  return getBase64PayloadSize(payload);
}

function getDataUrlSize(data: string): number {
  const fragment = data.indexOf("#");
  const end = fragment < 0 ? data.length : fragment;
  const comma = data.indexOf(",");
  if (comma < 0 || comma >= end) {
    return 0;
  }
  let payload = data.slice(comma + 1, end);
  if (/;base64$/i.test(data.slice(0, comma))) {
    if (/[%\t\n\f\r ]/.test(payload)) {
      payload = payload
        .replace(/%([\da-f]{2})/gi, (_match, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        )
        .replace(/[\t\n\f\r ]/g, "");
    }
    return getBase64PayloadSize(payload);
  }

  // Each percent escape is one byte, including octets that are not valid UTF-8.
  return new TextEncoder().encode(payload.replace(/%[\da-f]{2}/gi, "_"))
    .byteLength;
}

function getFileLabel(mimeType: string): string {
  const subtype = /^[^/;]+\/(?:x-)?(?:[^;+]*\.)?([^;+.\s]+)/.exec(
    mimeType.toLowerCase(),
  )?.[1];
  if (!subtype || subtype === "octet-stream") return "File";
  if (subtype === "plain") return "Text file";
  return `${subtype.toUpperCase()} file`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileRootProps = React.ComponentProps<"div"> &
  VariantProps<typeof fileVariants>;

function FileRoot({
  className,
  variant,
  size,
  children,
  ...props
}: FileRootProps) {
  return (
    <div
      data-slot="file-root"
      data-variant={variant}
      data-size={size}
      className={cn(fileVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  );
}

type FileIconDisplayProps = React.ComponentProps<"span"> & {
  mimeType?: string;
};

function FileIconDisplay({
  mimeType,
  className,
  children,
  ...props
}: FileIconDisplayProps) {
  const IconComponent = mimeType ? getMimeTypeIcon(mimeType) : FileIcon;

  return (
    <span
      data-slot="file-icon"
      className={cn("tw:text-muted-foreground tw:shrink-0", className)}
      {...props}
    >
      {/* eslint-disable-next-line react-hooks/static-components -- The helper only selects module-level icon components. */}
      {children ?? <IconComponent className="tw:size-5" />}
    </span>
  );
}

function FileName({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-name"
      className={cn("tw:min-w-0 tw:flex-1 tw:truncate tw:font-medium", className)}
      {...props}
    >
      {children || "Unnamed file"}
    </span>
  );
}

type FileSizeProps = React.ComponentProps<"span"> & {
  bytes: number;
};

function FileSize({ bytes, className, ...props }: FileSizeProps) {
  return (
    <span
      data-slot="file-size"
      className={cn("tw:text-muted-foreground tw:shrink-0", className)}
      {...props}
    >
      {formatFileSize(bytes)}
    </span>
  );
}

type FileDownloadProps = Omit<React.ComponentProps<"a">, "href"> & {
  data: string;
  mimeType: string;
  filename?: string;
  sourceType?: "url" | "id";
};

function FileDownload({
  data,
  mimeType,
  filename,
  sourceType,
  className,
  children,
  ...props
}: FileDownloadProps) {
  if (typeof data !== "string") return null;
  const kind = getFileDataKind(data, sourceType);
  const href = getFileHref(data, mimeType, sourceType);
  if (!href) return null;

  return (
    <a
      data-slot="file-download"
      href={href}
      download={filename || "download"}
      {...(kind === "url" && { target: "_blank", rel: "noopener noreferrer" })}
      className={cn(
        "tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground tw:shrink-0 tw:rounded-md tw:p-1 tw:transition-colors",
        className,
      )}
      aria-label={!children ? `Download ${filename || "file"}` : undefined}
      {...props}
    >
      {children || <DownloadIcon className="tw:size-4" />}
    </a>
  );
}

export interface FilePlayerProps extends Omit<
  React.ComponentProps<"div">,
  "children"
> {
  data: string;
  mimeType: string;
  filename?: string | undefined;
  sourceType?: "url" | "id" | undefined;
}

function FilePlayer({
  data,
  mimeType,
  filename,
  sourceType,
  className,
  ...props
}: FilePlayerProps) {
  const src = getFileHref(data, mimeType, sourceType);
  const normalizedMimeType = mimeType.toLowerCase();

  if (
    !src ||
    (!normalizedMimeType.startsWith("audio/") &&
      !normalizedMimeType.startsWith("video/"))
  ) {
    return null;
  }

  return (
    <div data-slot="file-player" className={cn("tw:w-full", className)} {...props}>
      {normalizedMimeType.startsWith("audio/") ? (
        <AudioPlayer src={src} title={filename} />
      ) : (
        <VideoPlayer src={src} title={filename} />
      )}
    </div>
  );
}

const FileImpl: FileMessagePartComponent = ({
  filename,
  data,
  mimeType,
  sourceType,
}) => {
  const kind = getFileDataKind(data, sourceType);
  const showSize =
    typeof data === "string" && (kind === "base64" || kind === "data-uri");
  const mediaSource = getFileHref(data, mimeType, sourceType);
  const isMedia =
    mimeType.toLowerCase().startsWith("audio/") ||
    mimeType.toLowerCase().startsWith("video/");

  if (mediaSource && isMedia) {
    return (
      <div className="tw:flex tw:w-full tw:max-w-xl tw:flex-col tw:gap-2">
        <FilePlayer
          data={data}
          mimeType={mimeType}
          {...(filename !== undefined && { filename })}
          {...(sourceType !== undefined && { sourceType })}
        />
        <div className="tw:flex tw:min-w-0 tw:items-center tw:justify-end tw:gap-2 tw:px-1">
          {showSize && (
            <FileSize
              bytes={
                kind === "data-uri" ? getDataUrlSize(data) : getBase64Size(data)
              }
              className="tw:text-muted-foreground tw:text-[11px]"
            />
          )}
          <FileDownload
            data={data}
            mimeType={mimeType}
            {...(filename !== undefined && { filename })}
            {...(sourceType !== undefined && { sourceType })}
          />
        </div>
      </div>
    );
  }

  return (
    <FileRoot>
      <FileIconDisplay mimeType={mimeType} />
      <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-0.5">
        <FileName>{filename || getFileLabel(mimeType)}</FileName>
        {showSize && (
          <FileSize
            bytes={
              kind === "data-uri" ? getDataUrlSize(data) : getBase64Size(data)
            }
            className="tw:text-xs"
          />
        )}
      </div>
      <FileDownload
        data={data}
        mimeType={mimeType}
        {...(filename !== undefined && { filename })}
        {...(sourceType !== undefined && { sourceType })}
      />
    </FileRoot>
  );
};

const File = memo(FileImpl) as unknown as FileMessagePartComponent & {
  Root: typeof FileRoot;
  Icon: typeof FileIconDisplay;
  Name: typeof FileName;
  Size: typeof FileSize;
  Download: typeof FileDownload;
  Player: typeof FilePlayer;
};

File.displayName = "File";
File.Root = FileRoot;
File.Icon = FileIconDisplay;
File.Name = FileName;
File.Size = FileSize;
File.Download = FileDownload;
File.Player = FilePlayer;

export {
  File,
  FileRoot,
  FileIconDisplay,
  FileName,
  FileSize,
  FileDownload,
  FilePlayer,
  fileVariants,
  getMimeTypeIcon,
  getFileDataKind,
  getFileHref,
  getBase64Size,
  formatFileSize,
};
