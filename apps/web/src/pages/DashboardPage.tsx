import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { ErrorMessage } from '../components/ui/ErrorMessage';
import { TripListSkeleton } from '../components/ui/Skeleton';

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

interface Client {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  setup:      { label: 'Setup',      color: 'bg-gray-100 text-gray-600' },
  ingestion:  { label: 'Ingestion',  color: 'bg-yellow-100 text-yellow-700' },
  research:   { label: 'Research',   color: 'bg-blue-100 text-blue-700' },
  draft:      { label: 'Draft',      color: 'bg-orange-100 text-orange-700' },
  review:     { label: 'Review',     color: 'bg-purple-100 text-purple-700' },
  complete:   { label: 'Complete',   color: 'bg-green-100 text-green-700' },
};

export function DashboardPage() {
  const { apiFetch } = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const clientFilter = searchParams.get('client') ?? '';

  const { data: trips, isLoading: tripsLoading, error: tripsError } = useQuery({
    queryKey: ['trips'],
    queryFn: () => apiFetch<Trip[]>('/trips'),
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiFetch<Client[]>('/clients'),
  });

  const filtered = clientFilter
    ? trips?.filter((t) => t.clients?.id === clientFilter)
    : trips;

  const selectedClientName = clients?.find((c) => c.id === clientFilter)?.name;

  function setFilter(id: string) {
    if (id) setSearchParams({ client: id });
    else setSearchParams({});
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
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

      {/* Client filter */}
      {clients && clients.length > 0 && (
        <div className="mb-6">
          <select
            value={clientFilter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {clientFilter && (
            <button
              onClick={() => setFilter('')}
              className="ml-3 text-sm text-gray-400 hover:text-gray-700 underline"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* States */}
      {tripsLoading && <TripListSkeleton />}
      {tripsError && <ErrorMessage message="Could not load trips. Make sure the API server is running." />}

      {/* Empty state — no trips at all */}
      {!tripsLoading && !tripsError && trips?.length === 0 && (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-500 font-medium mb-1">No trips yet</p>
          <p className="text-sm text-gray-400 mb-6">Create your first trip to get started.</p>
          <Link
            to="/trips/new"
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            + Create first trip
          </Link>
        </div>
      )}

      {/* Empty state — client filter has no results */}
      {!tripsLoading && !tripsError && trips && trips.length > 0 && filtered?.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No trips for {selectedClientName ?? 'this client'}.</p>
          <Link to="/trips/new" className="mt-3 inline-block text-sm text-slate-600 underline hover:text-slate-900">
            Create a trip for them
          </Link>
        </div>
      )}

      {/* Trip list */}
      {filtered && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((trip) => {
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
