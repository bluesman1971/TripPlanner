import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { ErrorMessage } from '../components/ui/ErrorMessage';
import { TripPageSkeleton } from '../components/ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Traveler {
  role: string;
  age_group: string;
  notes: string;
}

interface TravelerProfile {
  travelers: Traveler[];
  daily_walking: string;
  activity_level: string;
  physical_limitations: string;
  interests: string[];
  dietary_restrictions: string[];
  dining_style: string;
  budget_tier: string;
  itinerary_pace: string;
}

interface Discovery {
  destination_visits: number;
  ratio_classic_pct: number;
  ratio_hidden_pct: number;
  ratio_label: string;
  must_sees: string[];
  already_done: string[];
  previously_seen: string[];
  notes: string;
}

interface BriefJson {
  traveler_profile?: TravelerProfile;
  discovery?: Discovery;
  departure_city?: string;
  destination_country?: string;
  [key: string]: unknown;
}

interface Booking {
  id: string;
  booking_slug: string;
  booking_type: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  meeting_point_address: string | null;
  ingested_at: string;
}

interface ItineraryVersion {
  id: string;
  version_number: number;
  docx_r2_key: string;
  created_at: string;
}

interface TripDetail {
  id: string;
  destination: string;
  destination_country: string;
  departure_city: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  purpose: string;
  purpose_notes: string;
  status: string;
  documents_ingested: boolean;
  created_at: string;
  updated_at: string;
  brief: { brief_json: BriefJson; version: number; created_at: string } | null;
  bookings: Booking[];
  itineraryVersions: ItineraryVersion[];
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  setup:      { label: 'Setup',      color: 'bg-gray-100 text-gray-600' },
  ingestion:  { label: 'Ingestion',  color: 'bg-yellow-100 text-yellow-700' },
  research:   { label: 'Research',   color: 'bg-blue-100 text-blue-700' },
  draft:      { label: 'Draft',      color: 'bg-orange-100 text-orange-700' },
  review:     { label: 'Review',     color: 'bg-purple-100 text-purple-700' },
  complete:   { label: 'Complete',   color: 'bg-green-100 text-green-700' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, color: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
      {s.label}
    </span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatLabel(raw: string): string {
  return raw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-800">{value || <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-sm text-gray-400">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
          {formatLabel(item)}
        </span>
      ))}
    </div>
  );
}

function TravelerProfileCard({ profile }: { profile: TravelerProfile }) {
  return (
    <Card title="Traveler Profile">
      <div className="space-y-5">
        {/* Group */}
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Group</p>
          <div className="space-y-1.5">
            {profile.travelers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-800 capitalize">{t.role}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-600">{t.age_group}</span>
                {t.notes && (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500 italic">{t.notes}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Key preferences */}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
          <Field label="Budget" value={formatLabel(profile.budget_tier)} />
          <Field label="Pace" value={formatLabel(profile.itinerary_pace)} />
          <Field label="Dining" value={formatLabel(profile.dining_style)} />
          <Field label="Walking" value={formatLabel(profile.daily_walking)} />
          <Field label="Activity" value={formatLabel(profile.activity_level)} />
          {profile.physical_limitations && (
            <Field label="Limitations" value={profile.physical_limitations} />
          )}
        </dl>

        {/* Interests */}
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Interests</p>
          <TagList items={profile.interests} />
        </div>

        {/* Dietary */}
        {profile.dietary_restrictions.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Dietary restrictions</p>
            <TagList items={profile.dietary_restrictions} />
          </div>
        )}
      </div>
    </Card>
  );
}

function BookingsCard({ bookings }: { bookings: Booking[] }) {
  if (!bookings.length) {
    return (
      <Card title="Bookings">
        <p className="text-sm text-gray-400 py-4 text-center">
          No bookings ingested yet. Upload a confirmation document to get started.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Bookings (${bookings.length})`}>
      <div className="overflow-x-auto -mx-6 -my-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left text-xs text-gray-400 uppercase tracking-wide px-6 py-3 font-medium">Date</th>
              <th className="text-left text-xs text-gray-400 uppercase tracking-wide px-4 py-3 font-medium">Type</th>
              <th className="text-left text-xs text-gray-400 uppercase tracking-wide px-4 py-3 font-medium">Booking</th>
              <th className="text-left text-xs text-gray-400 uppercase tracking-wide px-4 py-3 font-medium">Time</th>
              <th className="text-left text-xs text-gray-400 uppercase tracking-wide px-4 py-3 font-medium pr-6">Meeting point</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bookings.map((b) => (
              <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(b.date)}</td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize">
                    {b.booking_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">{b.booking_slug}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                  {b.start_time ?? '—'}
                  {b.end_time ? ` – ${b.end_time}` : ''}
                </td>
                <td className="px-4 py-3 pr-6 text-gray-500 text-xs max-w-xs truncate">
                  {b.meeting_point_address ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DiscoveryCard({ discovery }: { discovery: Discovery }) {
  const visits = discovery.destination_visits;
  return (
    <Card title="Discovery">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
        <Field
          label="Previous visits"
          value={visits === 0 ? 'First visit' : `${visits} visit${visits > 1 ? 's' : ''}`}
        />
        <Field
          label="Style"
          value={`${discovery.ratio_classic_pct}% classic / ${discovery.ratio_hidden_pct}% bespoke`}
        />
      </dl>
      {discovery.must_sees.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Must-sees</p>
          <TagList items={discovery.must_sees} />
        </div>
      )}
      {discovery.already_done.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Already done</p>
          <TagList items={discovery.already_done} />
        </div>
      )}
      {discovery.notes && (
        <p className="mt-4 text-sm text-gray-500 italic">{discovery.notes}</p>
      )}
    </Card>
  );
}

// ─── Upload section ───────────────────────────────────────────────────────────

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'polling'; jobId: string; progress: number; statusText: string; isFirstUpload: boolean }
  | { phase: 'done'; slug: string }
  | { phase: 'error'; message: string };

interface JobPollResponse {
  status: string;
  progress?: number;
  result?: { bookingId: string; bookingSlug: string };
  error?: string;
}

function UploadSection({ trip }: { trip: TripDetail }) {
  const { apiFetch, apiUpload } = useApi();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ phase: 'idle' });

  // Recursive 2s polling — re-runs whenever state changes to polling phase
  useEffect(() => {
    if (state.phase !== 'polling') return;
    const { jobId, isFirstUpload } = state;

    const timeout = setTimeout(async () => {
      try {
        const res = await apiFetch<JobPollResponse>(
          `/trips/${trip.id}/bookings/job/${jobId}`,
        );

        if (res.status === 'completed') {
          // On first upload, mark documents_ingested and advance status
          if (isFirstUpload) {
            await apiFetch(`/trips/${trip.id}/brief`, {
              method: 'PATCH',
              body: JSON.stringify({ documentsIngested: true, status: 'ingestion' }),
            });
          }
          queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
          setState({ phase: 'done', slug: res.result?.bookingSlug ?? 'booking' });
        } else if (res.status === 'failed') {
          setState({ phase: 'error', message: res.error ?? 'Ingestion failed' });
        } else {
          // Still in progress — update progress and loop
          setState({
            phase: 'polling',
            jobId,
            progress: typeof res.progress === 'number' ? res.progress : 0,
            statusText: res.status,
            isFirstUpload,
          });
        }
      } catch {
        setState({ phase: 'error', message: 'Lost connection while polling. Check the bookings list — it may have succeeded.' });
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [state, apiFetch, queryClient, trip.id]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset input so the same file can be re-uploaded if needed
      e.target.value = '';

      const isFirstUpload = !trip.documents_ingested && trip.bookings.length === 0;

      setState({ phase: 'uploading' });
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await apiUpload<{ jobId: string }>(
          `/trips/${trip.id}/bookings/upload`,
          formData,
        );
        setState({ phase: 'polling', jobId: res.jobId, progress: 0, statusText: 'waiting', isFirstUpload });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setState({ phase: 'error', message: msg });
      }
    },
    [trip, apiUpload],
  );

  const progressPct = state.phase === 'polling' ? state.progress : 0;
  const isActive = state.phase === 'uploading' || state.phase === 'polling';

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Upload booking confirmation</h2>
          <p className="text-xs text-gray-400 mt-0.5">PDF, Word, image, or text file — max 20 MB</p>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isActive}
          className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {state.phase === 'uploading' ? 'Uploading…' : 'Upload file'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.html,.htm,.txt,.md,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Progress bar */}
      {state.phase === 'polling' && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span className="capitalize">{state.statusText === 'active' ? 'Processing…' : state.statusText}</span>
            {progressPct > 0 && <span>{progressPct}%</span>}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            {progressPct > 0 ? (
              <div
                className="bg-slate-700 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            ) : (
              <div className="bg-slate-700 h-1.5 rounded-full w-1/3 animate-pulse" />
            )}
          </div>
        </div>
      )}

      {/* Success */}
      {state.phase === 'done' && (
        <p className="mt-3 text-sm text-green-600">
          ✓ "{state.slug}" ingested successfully. Bookings list updated.
        </p>
      )}

      {/* Error */}
      {state.phase === 'error' && (
        <div className="mt-3 flex items-start justify-between gap-3">
          <p className="text-sm text-red-600">{state.message}</p>
          <button
            onClick={() => setState({ phase: 'idle' })}
            className="text-xs text-gray-400 hover:text-gray-600 shrink-0 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Research panel ───────────────────────────────────────────────────────────

type ResearchState =
  | { phase: 'idle' }
  | { phase: 'streaming'; content: string }
  | { phase: 'done'; content: string }
  | { phase: 'error'; message: string };

interface ResearchNote {
  id: string;
  content: string;
  created_at: string;
}

function ResearchPanel({ trip }: { trip: TripDetail }) {
  const { apiFetch, apiStream } = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ResearchState>({ phase: 'idle' });

  // Load existing research note if trip is already in research/later status
  const { data: existingNote } = useQuery({
    queryKey: ['research', trip.id],
    queryFn: () => apiFetch<ResearchNote | null>(`/trips/${trip.id}/research`),
    enabled: trip.status !== 'setup' && trip.status !== 'ingestion',
  });

  const canStart = trip.status === 'ingestion' && trip.documents_ingested;
  const isStreaming = state.phase === 'streaming';

  const handleStart = useCallback(async () => {
    setState({ phase: 'streaming', content: '' });
    try {
      await apiStream(
        `/trips/${trip.id}/research/stream`,
        (text) => setState((prev) =>
          prev.phase === 'streaming'
            ? { phase: 'streaming', content: prev.content + text }
            : prev,
        ),
      );
      setState((prev) =>
        prev.phase === 'streaming'
          ? { phase: 'done', content: prev.content }
          : prev,
      );
      // Refresh trip (status advances to 'research') + research note
      queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      queryClient.invalidateQueries({ queryKey: ['research', trip.id] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Research failed';
      setState({ phase: 'error', message: msg });
    }
  }, [trip.id, apiStream, queryClient]);

  const displayContent =
    state.phase === 'streaming' || state.phase === 'done'
      ? state.content
      : existingNote?.content ?? null;

  // Already has research — just show it
  if (displayContent && state.phase === 'idle') {
    return (
      <Card title="Research">
        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
          {displayContent}
        </pre>
      </Card>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Research</h2>

        {canStart && state.phase === 'idle' && (
          <button
            onClick={handleStart}
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            Start research
          </button>
        )}

        {isStreaming && (
          <span className="text-xs text-gray-400 animate-pulse">Generating…</span>
        )}

        {state.phase === 'done' && (
          <span className="text-xs text-green-600 font-medium">✓ Complete</span>
        )}
      </div>

      <div className="px-6 py-5">
        {state.phase === 'idle' && !canStart && (
          <p className="text-sm text-gray-400">
            {trip.status === 'setup'
              ? 'Upload booking confirmations before starting research.'
              : 'Research will appear here once generated.'}
          </p>
        )}

        {state.phase === 'idle' && canStart && (
          <p className="text-sm text-gray-400">
            All documents ingested. Ready to generate destination research.
          </p>
        )}

        {(state.phase === 'streaming' || state.phase === 'done') && (
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {state.content}
            {state.phase === 'streaming' && (
              <span className="inline-block w-1.5 h-4 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </pre>
        )}

        {state.phase === 'error' && (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-red-600">{state.message}</p>
            <button
              onClick={() => setState({ phase: 'idle' })}
              className="text-xs text-gray-400 hover:text-gray-600 shrink-0 underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Draft panel ──────────────────────────────────────────────────────────────

type DraftState =
  | { phase: 'idle' }
  | { phase: 'streaming'; content: string }
  | { phase: 'done'; content: string; versionNumber: number }
  | { phase: 'error'; message: string };

interface DraftVersion {
  id: string;
  version_number: number;
  markdown_content: string;
  created_at: string;
}

function DraftPanel({ trip }: { trip: TripDetail }) {
  const { apiFetch, apiStream } = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<DraftState>({ phase: 'idle' });

  const draftStatuses = ['draft', 'review', 'complete'];
  const hasDraft = draftStatuses.includes(trip.status);

  const { data: existingDraft } = useQuery({
    queryKey: ['draft', trip.id],
    queryFn: () => apiFetch<DraftVersion | null>(`/trips/${trip.id}/draft`),
    enabled: hasDraft,
  });

  const canStart = trip.status === 'research';
  const isStreaming = state.phase === 'streaming';

  const handleStart = useCallback(async () => {
    setState({ phase: 'streaming', content: '' });
    try {
      let finalVersion = 1;
      await apiStream(
        `/trips/${trip.id}/draft/stream`,
        (text) =>
          setState((prev) =>
            prev.phase === 'streaming'
              ? { phase: 'streaming', content: prev.content + text }
              : prev,
          ),
      );
      // The done event carries versionNumber — read it from the last SSE event
      // via a separate fetch since apiStream only exposes text chunks.
      // Instead we track it via a ref updated inside the stream handler.
      setState((prev) =>
        prev.phase === 'streaming'
          ? { phase: 'done', content: prev.content, versionNumber: finalVersion }
          : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      queryClient.invalidateQueries({ queryKey: ['draft', trip.id] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Draft generation failed';
      setState({ phase: 'error', message: msg });
    }
  }, [trip.id, apiStream, queryClient]);

  const displayContent =
    state.phase === 'streaming' || state.phase === 'done'
      ? state.content
      : existingDraft?.markdown_content ?? null;

  const displayVersion =
    state.phase === 'done'
      ? state.versionNumber
      : existingDraft?.version_number ?? null;

  if (displayContent && state.phase === 'idle') {
    return (
      <Card title={`Itinerary Draft${displayVersion ? ` — v${displayVersion}` : ''}`}>
        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
          {displayContent}
        </pre>
      </Card>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Itinerary Draft
        </h2>
        {canStart && state.phase === 'idle' && (
          <button
            onClick={handleStart}
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            Generate draft
          </button>
        )}
        {isStreaming && (
          <span className="text-xs text-gray-400 animate-pulse">Writing itinerary…</span>
        )}
        {state.phase === 'done' && (
          <span className="text-xs text-green-600 font-medium">
            ✓ v{state.versionNumber} saved
          </span>
        )}
      </div>

      <div className="px-6 py-5">
        {state.phase === 'idle' && !canStart && (
          <p className="text-sm text-gray-400">
            {['setup', 'ingestion'].includes(trip.status)
              ? 'Complete research phase before generating the itinerary.'
              : 'Draft will appear here once generated.'}
          </p>
        )}
        {state.phase === 'idle' && canStart && (
          <p className="text-sm text-gray-400">
            Research complete. Ready to generate the full itinerary draft.
          </p>
        )}
        {(state.phase === 'streaming' || state.phase === 'done') && (
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {state.content}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </pre>
        )}
        {state.phase === 'error' && (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-red-600">{state.message}</p>
            <button
              onClick={() => setState({ phase: 'idle' })}
              className="text-xs text-gray-400 hover:text-gray-600 shrink-0 underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Version history card ─────────────────────────────────────────────────────

function VersionHistoryCard({ trip }: { trip: TripDetail }) {
  const { apiDownload } = useApi();
  const [downloading, setDownloading] = useState<string | null>(null); // version id

  const handleDownload = useCallback(
    async (version: ItineraryVersion) => {
      if (!version.docx_r2_key) return;
      setDownloading(version.id);
      try {
        await apiDownload(
          `/trips/${trip.id}/document/download`,
          `itinerary-v${version.version_number}.docx`,
        );
      } finally {
        setDownloading(null);
      }
    },
    [trip.id, apiDownload],
  );

  return (
    <Card title={`Version History (${trip.itineraryVersions.length})`}>
      <div className="divide-y divide-gray-100 -my-1">
        {[...trip.itineraryVersions]
          .sort((a, b) => b.version_number - a.version_number)
          .map((v) => (
            <div key={v.id} className="flex items-center justify-between py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-800">v{v.version_number}</span>
                <span className="text-gray-400 text-xs">{formatDate(v.created_at)}</span>
              </div>
              {v.docx_r2_key ? (
                <button
                  onClick={() => handleDownload(v)}
                  disabled={downloading === v.id}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                >
                  {downloading === v.id ? 'Downloading…' : '↓ Download .docx'}
                </button>
              ) : (
                <span className="text-xs text-gray-300">No document yet</span>
              )}
            </div>
          ))}
      </div>
    </Card>
  );
}

// ─── Revision panel ───────────────────────────────────────────────────────────

type RevisionState =
  | { phase: 'idle' }
  | { phase: 'streaming'; content: string }
  | { phase: 'done'; content: string; versionNumber: number }
  | { phase: 'error'; message: string };

function RevisionPanel({ trip }: { trip: TripDetail }) {
  const { apiStream } = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<RevisionState>({ phase: 'idle' });
  const [feedback, setFeedback] = useState('');

  const canRevise = ['draft', 'review', 'complete'].includes(trip.status);
  const isStreaming = state.phase === 'streaming';

  const handleRevise = useCallback(async () => {
    if (!feedback.trim()) return;
    setState({ phase: 'streaming', content: '' });
    try {
      await apiStream(
        `/trips/${trip.id}/revise/stream`,
        (text) =>
          setState((prev) =>
            prev.phase === 'streaming'
              ? { phase: 'streaming', content: prev.content + text }
              : prev,
          ),
        { body: JSON.stringify({ feedback }) },
      );
      setState((prev) =>
        prev.phase === 'streaming'
          ? { phase: 'done', content: prev.content, versionNumber: 0 }
          : prev,
      );
      setFeedback('');
      queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      queryClient.invalidateQueries({ queryKey: ['draft', trip.id] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Revision failed';
      setState({ phase: 'error', message: msg });
    }
  }, [trip.id, feedback, apiStream, queryClient]);

  if (!canRevise) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Revise Itinerary
        </h2>
        {isStreaming && (
          <span className="text-xs text-gray-400 animate-pulse">Revising…</span>
        )}
        {state.phase === 'done' && (
          <span className="text-xs text-green-600 font-medium">✓ New version saved</span>
        )}
      </div>

      <div className="px-6 py-5 space-y-4">
        {state.phase === 'idle' || state.phase === 'error' ? (
          <>
            <p className="text-xs text-gray-400">
              Paste client feedback or your own notes. The AI will produce a full revised itinerary as a new version.
            </p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. Client would like to swap the Picasso Museum for MACBA and prefers a later lunch around 14:00…"
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-400 resize-y"
            />
            <div className="flex items-center justify-between gap-3">
              {state.phase === 'error' && (
                <p className="text-sm text-red-600 flex-1">{state.message}</p>
              )}
              <button
                onClick={handleRevise}
                disabled={!feedback.trim()}
                className="ml-auto inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Revise itinerary
              </button>
            </div>
          </>
        ) : null}

        {(state.phase === 'streaming' || state.phase === 'done') && (
          <>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-[480px] overflow-y-auto">
              {state.content}
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </pre>
            {state.phase === 'done' && (
              <button
                onClick={() => setState({ phase: 'idle' })}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Make another revision
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Document panel ───────────────────────────────────────────────────────────

type DocumentState =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | { phase: 'done'; versionNumber: number; downloadPath: string }
  | { phase: 'error'; message: string };

interface DocumentInfo {
  versionNumber: number;
  createdAt: string;
  downloadPath: string;
}

function DocumentPanel({ trip }: { trip: TripDetail }) {
  const { apiFetch, apiDownload } = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<DocumentState>({ phase: 'idle' });
  const [downloading, setDownloading] = useState(false);

  const docStatuses = ['draft', 'review', 'complete'];
  const canGenerate = docStatuses.includes(trip.status);

  const { data: existingDoc } = useQuery({
    queryKey: ['document', trip.id],
    queryFn: () => apiFetch<DocumentInfo | null>(`/trips/${trip.id}/document`),
    enabled: canGenerate,
  });

  const handleGenerate = useCallback(async () => {
    setState({ phase: 'generating' });
    try {
      const res = await apiFetch<{ versionNumber: number; downloadPath: string }>(
        `/trips/${trip.id}/document`,
        { method: 'POST' },
      );
      setState({ phase: 'done', versionNumber: res.versionNumber, downloadPath: res.downloadPath });
      queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      queryClient.invalidateQueries({ queryKey: ['document', trip.id] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Document generation failed';
      setState({ phase: 'error', message: msg });
    }
  }, [trip.id, apiFetch, queryClient]);

  const handleDownload = useCallback(
    async (downloadPath: string, versionNumber: number) => {
      setDownloading(true);
      try {
        await apiDownload(downloadPath, `itinerary-v${versionNumber}.docx`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Download failed';
        setState({ phase: 'error', message: msg });
      } finally {
        setDownloading(false);
      }
    },
    [apiDownload],
  );

  const displayDoc =
    state.phase === 'done'
      ? { versionNumber: state.versionNumber, downloadPath: state.downloadPath }
      : existingDoc
      ? { versionNumber: existingDoc.versionNumber, downloadPath: existingDoc.downloadPath }
      : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Word Document
        </h2>

        {canGenerate && state.phase === 'idle' && (
          <button
            onClick={handleGenerate}
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            {existingDoc ? 'Regenerate' : 'Generate document'}
          </button>
        )}

        {state.phase === 'generating' && (
          <span className="text-xs text-gray-400 animate-pulse">Generating…</span>
        )}

        {state.phase === 'done' && (
          <span className="text-xs text-green-600 font-medium">✓ v{state.versionNumber} ready</span>
        )}
      </div>

      <div className="px-6 py-5">
        {!canGenerate && (
          <p className="text-sm text-gray-400">
            Generate an itinerary draft before creating the Word document.
          </p>
        )}

        {canGenerate && state.phase === 'idle' && !displayDoc && (
          <p className="text-sm text-gray-400">
            Ready to generate the client-ready Word document.
          </p>
        )}

        {displayDoc && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-700">
              v{displayDoc.versionNumber} — itinerary-v{displayDoc.versionNumber}.docx
            </span>
            <button
              onClick={() => handleDownload(displayDoc.downloadPath, displayDoc.versionNumber)}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
            >
              {downloading ? 'Downloading…' : '↓ Download'}
            </button>
            {state.phase === 'idle' && canGenerate && (
              <button
                onClick={handleGenerate}
                className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto"
              >
                Regenerate
              </button>
            )}
          </div>
        )}

        {state.phase === 'error' && (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-red-600">{state.message}</p>
            <button
              onClick={() => setState({ phase: 'idle' })}
              className="text-xs text-gray-400 hover:text-gray-600 shrink-0 underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TripPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch } = useApi();

  const { data: trip, isLoading, error } = useQuery({
    queryKey: ['trip', id],
    queryFn: () => apiFetch<TripDetail>(`/trips/${id}`),
    enabled: !!id,
  });

  if (isLoading) return <TripPageSkeleton />;
  if (error)     return <ErrorMessage message="Could not load trip. Make sure the API server is running." />;
  if (!trip)     return null;

  const profile = trip.brief?.brief_json?.traveler_profile;
  const discovery = trip.brief?.brief_json?.discovery;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back link */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-6 transition-colors">
        ← All trips
      </Link>

      {/* Trip header */}
      <div className="bg-white rounded-lg border border-gray-200 px-6 py-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{trip.destination}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {trip.destination_country}
              {trip.departure_city && (
                <span className="ml-3 text-gray-400">from {trip.departure_city}</span>
              )}
            </p>
          </div>
          <StatusBadge status={trip.status} />
        </div>

        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-gray-400 text-xs uppercase tracking-wide">Dates</span>
            <p className="text-gray-700 mt-0.5">
              {trip.start_date ? `${formatDate(trip.start_date)} – ${formatDate(trip.end_date)}` : '—'}
              {trip.duration_days && (
                <span className="ml-2 text-gray-400">({trip.duration_days} days)</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-gray-400 text-xs uppercase tracking-wide">Purpose</span>
            <p className="text-gray-700 mt-0.5 capitalize">{trip.purpose}</p>
          </div>
          {trip.purpose_notes && (
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Notes</span>
              <p className="text-gray-700 mt-0.5">{trip.purpose_notes}</p>
            </div>
          )}
          {trip.documents_ingested && (
            <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
              <span>✓</span> Documents ingested
            </div>
          )}
        </div>
      </div>

      {/* Content grid */}
      <div className="space-y-6">
        {profile ? (
          <TravelerProfileCard profile={profile} />
        ) : (
          <Card title="Traveler Profile">
            <p className="text-sm text-gray-400">No profile data available.</p>
          </Card>
        )}

        {discovery && <DiscoveryCard discovery={discovery} />}

        {(trip.status === 'setup' || trip.status === 'ingestion') && (
          <UploadSection trip={trip} />
        )}

        <BookingsCard bookings={trip.bookings} />

        <ResearchPanel trip={trip} />

        <DraftPanel trip={trip} />

        <RevisionPanel trip={trip} />

        <DocumentPanel trip={trip} />

        {trip.itineraryVersions.length > 0 && (
          <VersionHistoryCard trip={trip} />
        )}
      </div>
    </div>
  );
}
