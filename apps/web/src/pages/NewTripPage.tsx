import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useApi } from '../lib/api';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ErrorMessage } from '../components/ui/ErrorMessage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client { id: string; name: string; email: string }

type RatioLabel = 'classic-leaning' | 'balanced' | 'mostly-bespoke' | 'fully-bespoke';
type Purpose = 'anniversary' | 'vacation' | 'honeymoon' | 'birthday' | 'family' | 'business-leisure' | 'solo-exploration' | 'other';

interface WizardData {
  clientId: string;
  destination: string;
  destinationCountry: string;
  departureCity: string;
  startDate: string;
  endDate: string;
  durationDays: string;
  purpose: Purpose | '';
  purposeNotes: string;
  destinationVisits: number;
  previouslySeen: string[];
  classicPct: number;
  mustSees: string[];
  alreadyDone: string[];
  discoveryNotes: string;
}

const EMPTY: WizardData = {
  clientId: '', destination: '', destinationCountry: '', departureCity: '',
  startDate: '', endDate: '', durationDays: '',
  purpose: '', purposeNotes: '',
  destinationVisits: 0, previouslySeen: [], classicPct: 50,
  mustSees: [], alreadyDone: [], discoveryNotes: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getRatioLabel(classicPct: number): RatioLabel {
  if (classicPct >= 70) return 'classic-leaning';
  if (classicPct >= 40) return 'balanced';
  if (classicPct >= 15) return 'mostly-bespoke';
  return 'fully-bespoke';
}

function calcDuration(start: string, end: string): number | undefined {
  if (!start || !end) return undefined;
  const diff = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
  return diff > 0 ? Math.round(diff) + 1 : undefined;
}

// ─── Tag input ────────────────────────────────────────────────────────────────

function TagInput({ label, tags, onChange, placeholder }: {
  label: string; tags: string[]; placeholder?: string;
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput('');
  };
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex gap-2 mb-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? 'Type and press Enter'}
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        <button type="button" onClick={add}
          className="px-3 py-1.5 text-sm bg-slate-100 rounded-md hover:bg-slate-200">
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded-full">
              {tag}
              <button type="button" onClick={() => onChange(tags.filter(t => t !== tag))}
                className="text-slate-400 hover:text-slate-700 ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ['Client', 'Destination', 'Purpose', 'Discovery'];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className={`flex items-center gap-2 ${i <= current ? 'text-slate-900' : 'text-gray-400'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold
              ${i < current ? 'bg-slate-900 text-white' : i === current ? 'border-2 border-slate-900 text-slate-900' : 'border-2 border-gray-300 text-gray-400'}`}>
              {i < current ? '✓' : i + 1}
            </div>
            <span className="text-sm font-medium hidden sm:block">{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-8 sm:w-12 mx-2 ${i < current ? 'bg-slate-900' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Client ───────────────────────────────────────────────────────────

function StepClient({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  const { apiFetch } = useApi();
  const { data: clients, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiFetch<Client[]>('/clients'),
  });

  if (isLoading) return <LoadingSpinner message="Loading clients…" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Who is this trip for?</h2>
        <p className="text-sm text-gray-500 mt-1">Select the client you're planning this trip for.</p>
      </div>
      {clients?.length === 0 ? (
        <ErrorMessage message="No clients yet. Go to the Clients page and create one first." />
      ) : (
        <div className="space-y-2 mt-4">
          {clients?.map(client => (
            <button key={client.id} type="button"
              onClick={() => onChange({ clientId: client.id })}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors
                ${data.clientId === client.id
                  ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                  : 'border-gray-200 hover:border-slate-400'}`}>
              <p className="font-medium text-gray-900">{client.name}</p>
              <p className="text-sm text-gray-500">{client.email}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Destination ──────────────────────────────────────────────────────

function StepDestination({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  const field = (label: string, key: keyof WizardData, placeholder: string, type = 'text') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={data[key] as string}
        onChange={e => onChange({ [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Where are they going?</h2>
        <p className="text-sm text-gray-500 mt-1">Destination and travel dates.</p>
      </div>
      {field('Destination', 'destination', 'Barcelona, Spain')}
      {field('Country', 'destinationCountry', 'Spain')}
      {field('Departure city', 'departureCity', 'New York')}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
          <input type="date" value={data.startDate}
            onChange={e => {
              const start = e.target.value;
              const dur = calcDuration(start, data.endDate);
              onChange({ startDate: start, durationDays: dur ? String(dur) : '' });
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End date</label>
          <input type="date" value={data.endDate}
            onChange={e => {
              const end = e.target.value;
              const dur = calcDuration(data.startDate, end);
              onChange({ endDate: end, durationDays: dur ? String(dur) : '' });
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
      </div>
      {data.durationDays && (
        <p className="text-sm text-slate-600 font-medium">{data.durationDays} days</p>
      )}
    </div>
  );
}

// ─── Step 3: Purpose ──────────────────────────────────────────────────────────

const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: 'anniversary',       label: '💑 Anniversary' },
  { value: 'honeymoon',         label: '🥂 Honeymoon' },
  { value: 'vacation',          label: '🌴 Vacation' },
  { value: 'birthday',          label: '🎂 Birthday' },
  { value: 'family',            label: '👨‍👩‍👧 Family trip' },
  { value: 'business-leisure',  label: '💼 Business + leisure' },
  { value: 'solo-exploration',  label: '🧭 Solo exploration' },
  { value: 'other',             label: '✈️ Other' },
];

function StepPurpose({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">What's the occasion?</h2>
        <p className="text-sm text-gray-500 mt-1">This shapes the tone of the entire itinerary.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PURPOSE_OPTIONS.map(({ value, label }) => (
          <button key={value} type="button"
            onClick={() => onChange({ purpose: value })}
            className={`text-left px-4 py-3 rounded-lg border text-sm transition-colors
              ${data.purpose === value
                ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 font-medium'
                : 'border-gray-200 hover:border-slate-400'}`}>
            {label}
          </button>
        ))}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea value={data.purposeNotes}
          onChange={e => onChange({ purposeNotes: e.target.value })}
          rows={3} placeholder="e.g. First stop of a cruise vacation. Wife's 40th birthday."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
        />
      </div>
    </div>
  );
}

// ─── Step 4: Discovery ────────────────────────────────────────────────────────

const RATIO_LABELS: Record<RatioLabel, string> = {
  'classic-leaning': 'Classic-leaning — famous landmarks with a few local gems',
  'balanced':        'Balanced — mix of iconic sights and off-the-beaten-path',
  'mostly-bespoke':  'Mostly bespoke — local favourites, minimal tourist crowds',
  'fully-bespoke':   'Fully bespoke — hidden gems only, nothing in the guidebooks',
};

function StepDiscovery({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  const label = getRatioLabel(data.classicPct);
  const hiddenPct = 100 - data.classicPct;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Discovery profile</h2>
        <p className="text-sm text-gray-500 mt-1">How should we balance the itinerary?</p>
      </div>

      {/* Visits */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Times visited {data.destination || 'this destination'}
        </label>
        <div className="flex items-center gap-4">
          {[0, 1, 2, 3, '4+'].map(n => (
            <button key={n} type="button"
              onClick={() => onChange({ destinationVisits: n === '4+' ? 4 : Number(n) })}
              className={`w-12 h-12 rounded-full border text-sm font-medium transition-colors
                ${data.destinationVisits === (n === '4+' ? 4 : Number(n))
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-gray-300 hover:border-slate-500'}`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Ratio slider */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>🏛️ Classic ({data.classicPct}%)</span>
          <span>🗺️ Bespoke ({hiddenPct}%)</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={data.classicPct}
          onChange={e => onChange({ classicPct: Number(e.target.value) })}
          className="w-full accent-slate-900"
        />
        <div className="mt-2 text-sm text-slate-700 font-medium">{RATIO_LABELS[label]}</div>
      </div>

      {/* Must-sees */}
      <TagInput label="Must-sees" tags={data.mustSees}
        onChange={mustSees => onChange({ mustSees })}
        placeholder="e.g. Casa Batlló exterior" />

      {/* Already done */}
      {data.destinationVisits > 0 && (
        <TagInput label="Already done (skip these)" tags={data.alreadyDone}
          onChange={alreadyDone => onChange({ alreadyDone })}
          placeholder="e.g. Sagrada Família interior" />
      )}

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Additional notes <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea value={data.discoveryNotes}
          onChange={e => onChange({ discoveryNotes: e.target.value })}
          rows={2} placeholder="e.g. Client wants to avoid very touristy restaurants."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
        />
      </div>
    </div>
  );
}

// ─── Wizard container ─────────────────────────────────────────────────────────

export function NewTripPage() {
  const navigate = useNavigate();
  const { apiFetch } = useApi();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [submitError, setSubmitError] = useState('');

  const update = (patch: Partial<WizardData>) => setData(d => ({ ...d, ...patch }));

  // Validation per step
  const canAdvance = () => {
    if (step === 0) return !!data.clientId;
    if (step === 1) return !!(data.destination && data.destinationCountry);
    if (step === 2) return !!data.purpose;
    return true;
  };

  const mutation = useMutation({
    mutationFn: () => {
      const hiddenPct = 100 - data.classicPct;
      return apiFetch<{ id: string }>('/trips', {
        method: 'POST',
        body: JSON.stringify({
          clientId:           data.clientId,
          destination:        data.destination,
          destinationSlug:    toSlug(data.destination),
          destinationCountry: data.destinationCountry,
          departureCity:      data.departureCity || 'Unknown',
          startDate:          data.startDate || undefined,
          endDate:            data.endDate || undefined,
          durationDays:       data.durationDays ? Number(data.durationDays) : undefined,
          purpose:            data.purpose,
          purposeNotes:       data.purposeNotes,
          discovery: {
            destination_visits: data.destinationVisits,
            previously_seen:    data.previouslySeen,
            ratio_classic_pct:  data.classicPct,
            ratio_hidden_pct:   hiddenPct,
            ratio_label:        getRatioLabel(data.classicPct),
            must_sees:          data.mustSees,
            already_done:       data.alreadyDone,
            notes:              data.discoveryNotes,
          },
        }),
      });
    },
    onSuccess: (trip) => navigate(`/trips/${trip.id}`),
    onError: (err: Error) => setSubmitError(err.message),
  });

  const steps = [
    <StepClient      key={0} data={data} onChange={update} />,
    <StepDestination key={1} data={data} onChange={update} />,
    <StepPurpose     key={2} data={data} onChange={update} />,
    <StepDiscovery   key={3} data={data} onChange={update} />,
  ];

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">New trip</h1>
      </div>

      <StepIndicator current={step} />

      <div className="bg-white rounded-xl border border-gray-200 p-8">
        {steps[step]}

        {submitError && (
          <div className="mt-4">
            <ErrorMessage message={submitError} />
          </div>
        )}

        <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
          <button type="button"
            onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            {step === 0 ? 'Cancel' : '← Back'}
          </button>

          {step < 3 ? (
            <button type="button"
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
              className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-40 transition-colors">
              Continue →
            </button>
          ) : (
            <button type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-40 transition-colors">
              {mutation.isPending ? 'Creating…' : 'Create trip'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
