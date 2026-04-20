import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ErrorMessage } from '../components/ui/ErrorMessage';

interface Trip {
  id: string;
  destination: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  purpose: string;
  created_at: string;
  clients: { id: string; name: string } | null;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  setup:      { label: 'Setup',      color: 'bg-gray-100 text-gray-600' },
  ingestion:  { label: 'Ingestion',  color: 'bg-blue-100 text-blue-700' },
  research:   { label: 'Research',   color: 'bg-yellow-100 text-yellow-700' },
  draft:      { label: 'Draft',      color: 'bg-purple-100 text-purple-700' },
  review:     { label: 'Review',     color: 'bg-orange-100 text-orange-700' },
  final:      { label: 'Final',      color: 'bg-green-100 text-green-700' },
  delivered:  { label: 'Delivered',  color: 'bg-teal-100 text-teal-700' },
};

export function DashboardPage() {
  const { apiFetch } = useApi();

  const { data: trips, isLoading, error } = useQuery({
    queryKey: ['trips'],
    queryFn: () => apiFetch<Trip[]>('/trips'),
  });

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Trips</h1>
          <p className="text-sm text-gray-500 mt-1">All active and past itineraries</p>
        </div>
        <Link
          to="/trips/new"
          className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          + New trip
        </Link>
      </div>

      {/* States */}
      {isLoading && <LoadingSpinner message="Loading trips…" />}

      {error && (
        <ErrorMessage message="Could not load trips. Make sure the API server is running." />
      )}

      {/* Empty state */}
      {!isLoading && !error && trips?.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">No trips yet</p>
          <p className="text-sm">Create your first trip to get started.</p>
        </div>
      )}

      {/* Trip list */}
      {trips && trips.length > 0 && (
        <div className="space-y-3">
          {trips.map((trip) => {
            const status = STATUS_LABEL[trip.status] ?? { label: trip.status, color: 'bg-gray-100 text-gray-600' };
            return (
              <Link
                key={trip.id}
                to={`/trips/${trip.id}`}
                className="block bg-white rounded-lg border border-gray-200 px-6 py-4 hover:border-slate-400 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{trip.destination}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {trip.clients?.name ?? 'Unknown client'}
                      {trip.start_date && (
                        <span className="ml-3 text-gray-400">
                          {new Date(trip.start_date).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>
                    {status.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
