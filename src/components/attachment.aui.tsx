"use client";

import {
  type PropsWithChildren,
  useState,
  type FC,
  isValidElement,
} from "react";
import {
  XIcon,
  PlusIcon,
  FileText,
  Loader2Icon,
  AlertCircleIcon,
} from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { useAttachmentState } from "./attachment-state";
import { cn } from "@/lib/utils";

type AttachmentPreviewProps = {
  src: string;
  name: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src, name }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={`Preview of ${name}`}
      className={cn(
        "tw:block tw:h-auto tw:max-h-[80vh] tw:w-auto tw:max-w-full tw:rounded-sm tw:object-contain tw:transition-opacity tw:duration-300 tw:motion-reduce:transition-none",
        isLoaded
          ? "tw:aui-attachment-preview-image-loaded tw:opacity-100"
          : "tw:aui-attachment-preview-image-loading tw:opacity-0",
      )}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

type AttachmentPreviewDialogProps = PropsWithChildren<{
  src: string | undefined;
  name: string;
}>;

const AttachmentPreviewDialog: FC<AttachmentPreviewDialogProps> = ({
  children,
  src,
  name,
}) => {
  if (!src) return children;

  return (
    <Dialog>
      <DialogTrigger
        className="tw:aui-attachment-preview-trigger tw:cursor-zoom-in"
        asChild
      >
        {isValidElement(children) ? (
          children
        ) : (
          <button type="button">{children}</button>
        )}
      </DialogTrigger>
      <DialogContent className="tw:aui-attachment-preview-dialog-content tw:[&>button]:bg-foreground/60 tw:[&>button]:hover:bg-foreground/80 tw:[&_svg]:text-background tw:p-2 tw:sm:max-w-3xl tw:[&>button]:rounded-full tw:[&>button]:p-1 tw:[&>button]:opacity-100 tw:[&>button]:ring-0!">
        <DialogTitle className="tw:aui-sr-only tw:sr-only">
          Preview {name}
        </DialogTitle>
        <div className="tw:aui-attachment-preview tw:bg-background tw:relative tw:mx-auto tw:flex tw:max-h-[80dvh] tw:w-full tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-sm">
          <AttachmentPreview src={src} name={name} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb: FC<{ src: string | undefined }> = ({ src }) => {
  return (
    <Avatar className="tw:aui-attachment-tile-avatar tw:h-full tw:w-full tw:rounded-none">
      <AvatarImage
        src={src}
        alt=""
        className="tw:aui-attachment-tile-image tw:rounded-none tw:object-cover"
      />
      <AvatarFallback>
        <FileText className="tw:aui-attachment-tile-fallback-icon tw:text-muted-foreground/80 tw:size-6 tw:stroke-[1.5]" />
      </AvatarFallback>
    </Avatar>
  );
};

const AttachmentUI: FC = () => {
  const {
    isComposer,
    src,
    isImage,
    name,
    typeLabel,
    isUploading,
    isError,
    errorMessage,
  } = useAttachmentState();

  return (
    <TooltipProvider>
      <Tooltip>
        <AttachmentPrimitive.Root
          className={cn(
            "tw:aui-attachment-root tw:relative",
            isComposer &&
              "tw:animate-in tw:fade-in-0 tw:zoom-in-95 tw:duration-200 tw:motion-reduce:animate-none",
            isImage &&
              !isComposer &&
              "tw:aui-attachment-root-message tw:only:*:first:size-24",
          )}
        >
          <AttachmentPreviewDialog src={src} name={name}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "tw:aui-attachment-tile tw:bg-muted tw:hover:after:bg-foreground/10 tw:focus-visible:ring-ring/50 tw:relative tw:size-14 tw:overflow-hidden tw:rounded-[calc(var(--composer-radius,1rem)-var(--composer-padding,8px))] tw:transition-transform tw:outline-none tw:after:pointer-events-none tw:after:absolute tw:after:inset-0 tw:after:rounded-[inherit] tw:after:ring-1 tw:after:ring-black/10 tw:after:transition-colors tw:after:ring-inset tw:focus-visible:ring-1 tw:motion-reduce:transition-none tw:dark:after:ring-white/10",
                  src ? "tw:cursor-zoom-in tw:active:scale-[0.96]" : "tw:cursor-default",
                  isError &&
                    "tw:after:ring-destructive/60 tw:dark:after:ring-destructive/60",
                )}
                role={src ? "button" : "group"}
                tabIndex={0}
                onKeyDown={
                  src
                    ? (e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.click();
                        } else if (e.key === " ") {
                          e.preventDefault();
                        }
                      }
                    : undefined
                }
                onKeyUp={
                  src
                    ? (e) => {
                        if (e.key === " ") e.currentTarget.click();
                      }
                    : undefined
                }
                aria-label={`${src ? `Preview ${name}` : `${typeLabel} attachment ${name}`}${
                  isError ? ", upload failed" : isUploading ? ", uploading" : ""
                }`}
              >
                <AttachmentThumb src={src} />
                {isUploading && (
                  <div
                    aria-hidden="true"
                    className="tw:aui-attachment-tile-uploading tw:bg-background/60 tw:animate-in tw:fade-in-0 tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center tw:backdrop-blur-[2px] tw:motion-reduce:animate-none"
                  >
                    <Loader2Icon className="tw:text-muted-foreground tw:size-4 tw:animate-spin" />
                  </div>
                )}
                {isError && (
                  <div
                    aria-hidden="true"
                    className="tw:aui-attachment-tile-error tw:bg-background/70 tw:animate-in tw:fade-in-0 tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center tw:backdrop-blur-[2px] tw:motion-reduce:animate-none"
                  >
                    <AlertCircleIcon className="tw:text-destructive tw:size-4" />
                  </div>
                )}
              </div>
            </TooltipTrigger>
          </AttachmentPreviewDialog>
          {isComposer && <AttachmentRemove name={name} />}
        </AttachmentPrimitive.Root>
        <TooltipContent side="top">
          <AttachmentPrimitive.Name />
          {errorMessage && (
            <p className="tw:aui-attachment-error-message">{errorMessage}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const AttachmentRemove: FC<{ name: string }> = ({ name }) => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip={`Remove ${name}`}
        className="tw:aui-attachment-tile-remove tw:absolute tw:end-1 tw:top-1 tw:size-5 tw:rounded-full tw:bg-black/50! tw:text-white tw:after:absolute tw:after:-inset-1.5 tw:hover:bg-black/70! tw:hover:text-white! tw:active:scale-[0.96] tw:motion-reduce:transition-none"
        side="top"
      >
        <XIcon className="tw:aui-attachment-remove-icon tw:size-3 tw:stroke-[2.5]" />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="tw:aui-user-message-attachments-end tw:col-span-full tw:col-start-1 tw:row-start-1 tw:flex tw:w-full tw:flex-row tw:justify-end tw:gap-2 tw:empty:hidden">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="tw:aui-composer-attachments tw:flex tw:w-full tw:flex-row tw:items-center tw:gap-2 tw:overflow-x-auto tw:empty:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentUI />}
      </ComposerPrimitive.Attachments>
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <TooltipIconButton
        tooltip="Add Attachment"
        side="bottom"
        variant="ghost"
        size="icon"
        className="tw:aui-composer-add-attachment tw:text-muted-foreground tw:hover:text-foreground tw:hover:bg-muted-foreground/15 tw:dark:border-muted-foreground/15 tw:dark:hover:bg-muted-foreground/30 tw:size-7 tw:rounded-full tw:active:scale-[0.96] tw:motion-reduce:transition-none"
        aria-label="Add Attachment"
      >
        <PlusIcon className="tw:aui-attachment-add-icon tw:size-4" />
      </TooltipIconButton>
    </ComposerPrimitive.AddAttachment>
  );
};
