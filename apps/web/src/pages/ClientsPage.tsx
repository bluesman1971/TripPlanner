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
  phone: string;
  address_line: string;
  city: string;
  country: string;
  postal_code: string;
  created_at: string;
}

interface ClientPayload {
  name: string; email: string; phone: string;
  addressLine: string; city: string; country: string; postalCode: string;
}

// ─── Create / Edit client modal ───────────────────────────────────────────────

function ClientModal({ client, onClose }: { client?: Client; onClose: () => void }) {
  const { apiFetch } = useApi();
  const queryClient = useQueryClient();
  const isEdit = !!client;

  const [form, setForm] = useState<ClientPayload>({
    name:        client?.name        ?? '',
    email:       client?.email       ?? '',
    phone:       client?.phone       ?? '',
    addressLine: client?.address_line ?? '',
    city:        client?.city        ?? '',
    country:     client?.country     ?? '',
    postalCode:  client?.postal_code  ?? '',
  });
  const [error, setError] = useState('');

  const set = (key: keyof ClientPayload) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (payload: ClientPayload) =>
      isEdit
        ? apiFetch<Client>(`/clients/${client!.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : apiFetch<Client>('/clients', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    mutation.mutate(form);
  };

  const field = (label: string, key: keyof ClientPayload, placeholder: string, required = false, type = 'text') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
        {!required && <span className="text-gray-400 font-normal"> (optional)</span>}
      </label>
      <input type={type} value={form[key]} onChange={set(key)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-5">
          {isEdit ? 'Edit client' : 'New client'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Contact */}
          <div className="pb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contact information</p>
            <div className="space-y-3">
              {field('Full name', 'name', 'Jane Smith', true)}
              {field('Email address', 'email', 'jane@example.com', true, 'email')}
              {field('Phone number', 'phone', '+1 212 555 0100', false, 'tel')}
            </div>
          </div>

          {/* Address */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Home address</p>
            <div className="space-y-3">
              {field('Street address', 'addressLine', '123 Main Street')}
              <div className="grid grid-cols-2 gap-3">
                {field('City', 'city', 'New York')}
                {field('Postal / ZIP', 'postalCode', '10001')}
              </div>
              {field('Country', 'country', 'United States')}
            </div>
          </div>

          {error && <ErrorMessage message={error} />}

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create client'}
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
  const [modal, setModal] = useState<'create' | Client | null>(null);

  const { data: clients, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiFetch<Client[]>('/clients'),
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your client roster</p>
        </div>
        <button onClick={() => setModal('create')}
          className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors">
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
          {clients.map(client => (
            <div key={client.id}
              className="bg-white rounded-lg border border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{client.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{client.email}
                  {client.phone && <span className="ml-3 text-gray-400">{client.phone}</span>}
                </p>
                {(client.city || client.country) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[client.city, client.country].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setModal(client)}
                  className="text-sm text-gray-500 hover:text-gray-900">Edit</button>
                <Link to={`/?client=${client.id}`}
                  className="text-sm text-slate-600 hover:text-slate-900 font-medium">
                  View trips →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal === 'create' && <ClientModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && (
        <ClientModal client={modal as Client} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
