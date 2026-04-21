import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalTrip {
  id: string;
  destination: string;
  destinationCountry: string;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  clientName: string;
}

interface PortalItinerary {
  versionNumber: number;
  markdownContent: string;
  createdAt: string;
}

interface PortalData {
  trip: PortalTrip;
  itinerary: PortalItinerary;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    fetch(`${API_URL}/portal/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<PortalData>;
      })
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load itinerary.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading your itinerary…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Itinerary not found</h1>
          <p className="text-sm text-gray-500">
            {error ?? 'This link may have expired or been revoked. Please contact your travel consultant for a new link.'}
          </p>
        </div>
      </div>
    );
  }

  const { trip, itinerary } = data;
  const dateRange = trip.startDate
    ? `${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}`
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{trip.destination}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {trip.destinationCountry}
                {dateRange && <span className="ml-3 text-gray-400">{dateRange}</span>}
                {trip.durationDays && (
                  <span className="ml-2 text-gray-400">· {trip.durationDays} days</span>
                )}
              </p>
              {trip.clientName && (
                <p className="text-sm text-gray-400 mt-1">Prepared for {trip.clientName}</p>
              )}
            </div>

            {/* PDF download */}
            <a
              href={`${API_URL}/portal/${token}/pdf`}
              download
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </a>
          </div>
        </div>
      </header>

      {/* Itinerary content */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-white rounded-lg border border-gray-200 px-8 py-8">
          <div className="prose prose-gray max-w-none
            [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:mb-4 [&_h1]:mt-0
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-800 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-gray-100 [&_h2]:pb-2
            [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-800 [&_h3]:mt-5 [&_h3]:mb-2
            [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-gray-700 [&_h4]:mt-4 [&_h4]:mb-1
            [&_p]:text-gray-700 [&_p]:leading-relaxed [&_p]:mb-3
            [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ul]:space-y-1
            [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_ol]:space-y-1
            [&_li]:text-gray-700 [&_li]:leading-relaxed
            [&_strong]:font-semibold [&_strong]:text-gray-900
            [&_em]:italic [&_em]:text-gray-600
            [&_hr]:border-gray-200 [&_hr]:my-6
            [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-4 [&_blockquote]:text-gray-500 [&_blockquote]:italic
            [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse
            [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_th]:border [&_th]:border-gray-200
            [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-gray-200 [&_td]:text-gray-700
          ">
            <ReactMarkdown>{itinerary.markdownContent}</ReactMarkdown>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Version {itinerary.versionNumber} · Generated {formatDate(itinerary.createdAt)}
        </p>
      </main>
    </div>
  );
}
