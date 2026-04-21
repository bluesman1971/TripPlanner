import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ErrorMessage } from '../components/ui/ErrorMessage';

interface Client {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

interface CreateClientPayload {
  name: string;
  email: string;
}

// ─── Create client modal ──────────────────────────────────────────────────────

function CreateClientModal({ onClose }: { onClose: () => void }) {
  const { apiFetch } = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: CreateClientPayload) =>
      apiFetch<Client>('/clients', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    mutation.mutate({ name: name.trim(), email: email.trim() });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-5">New client</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          {error && <ErrorMessage message={error} />}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Creating…' : 'Create client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Clients page ─────────────────────────────────────────────────────────────

export function ClientsPage() {
  const { apiFetch } = useApi();
  const [showModal, setShowModal] = useState(false);

  const { data: clients, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiFetch<Client[]>('/clients'),
  });

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your client roster</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          + New client
        </button>
      </div>

      {isLoading && <LoadingSpinner message="Loading clients…" />}
      {error && <ErrorMessage message="Could not load clients. Make sure the API server is running." />}

      {!isLoading && !error && clients?.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">No clients yet</p>
          <p className="text-sm">Add your first client to get started.</p>
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="space-y-3">
          {clients.map((client) => (
            <div
              key={client.id}
              className="bg-white rounded-lg border border-gray-200 px-6 py-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-gray-900">{client.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{client.email}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-400">
                  Added {new Date(client.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </span>
                <Link
                  to={`/?client=${client.id}`}
                  className="text-sm text-slate-600 hover:text-slate-900 font-medium"
                >
                  View trips →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <CreateClientModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
