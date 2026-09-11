import {
  Briefcase,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  FileSignature,
  MessageSquare,
  PenLine,
  ThumbsUp,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

import type { Activity, User } from "@/db/schema";
import { ACTIVITY_TYPES, type ActivityType, type Tone } from "@/lib/domain";
import { cn, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { toneVars } from "@/components/ui/tone";

const ICONS: Record<string, typeof Briefcase> = {
  requisition_created: Briefcase,
  requisition_updated: PenLine,
  requisition_status: Briefcase,
  candidate_created: UserPlus,
  candidate_updated: PenLine,
  submission_created: Users,
  stage_changed: Users,
  submission_rejected: XCircle,
  interview_scheduled: CalendarPlus,
  interview_completed: CalendarCheck,
  interview_cancelled: CalendarX,
  feedback_submitted: ThumbsUp,
  offer_created: FileSignature,
  offer_status: FileSignature,
  note_added: MessageSquare,
};

export function ActivityFeed({
  items,
  className,
  compact = false,
}: {
  items: { activity: Activity; actor: User | null }[];
  className?: string;
  compact?: boolean;
}) {
  if (!items.length) {
    return (
      <EmptyState
        compact
        icon={<MessageSquare className="size-5" />}
        title="No activity yet"
        description="Actions taken in the system show up here."
      />
    );
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      {items.map(({ activity, actor }, i) => {
        const meta = ACTIVITY_TYPES[activity.type as ActivityType];
        const Icon = ICONS[activity.type] ?? MessageSquare;
        const tone: Tone = meta?.tone ?? "slate";
        const last = i === items.length - 1;

        return (
          <li key={activity.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last ? (
              <span
                className="absolute top-7 bottom-0 left-[13px] w-px bg-border-base"
                aria-hidden
              />
            ) : null}

            <span
              style={toneVars(tone)}
              className="tone-chip relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full"
            >
              <Icon className="size-3.5" />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn("text-[13px] leading-snug text-content", compact && "truncate")}>
                {activity.summary}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11.5px] text-content-subtle">
                {actor ? (
                  <>
                    <Avatar name={actor.name} size="xs" />
                    <span className="truncate">{actor.name}</span>
                    <span aria-hidden>·</span>
                  </>
                ) : null}
                <time dateTime={activity.createdAt.toISOString()}>
                  {relativeTime(activity.createdAt)}
                </time>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
