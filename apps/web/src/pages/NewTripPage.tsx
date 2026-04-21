import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useApi } from '../lib/api';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ErrorMessage } from '../components/ui/ErrorMessage';
import type { INTEREST_OPTIONS } from '@trip-planner/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client { id: string; name: string; email: string }

type Role = 'primary' | 'partner' | 'child' | 'parent' | 'sibling' | 'friend' | 'colleague';
type AgeGroup = '20s' | '30s' | '40s' | '50s' | '60s' | '70s+' | 'teen' | 'child' | 'young-child';
type RatioLabel = 'classic-leaning' | 'balanced' | 'mostly-bespoke' | 'fully-bespoke';
type Purpose = 'anniversary' | 'vacation' | 'honeymoon' | 'birthday' | 'family' | 'business-leisure' | 'solo-exploration' | 'other';

interface Traveler { role: Role; age_group: AgeGroup; notes: string }

interface WizardData {
  // Step 1 — Client
  clientId: string;
  // Step 2 — Group
  travelers: Traveler[];
  // Step 3 — Preferences
  daily_walking: 'low' | 'medium' | 'high';
  activity_level: 'relaxed' | 'moderate' | 'active';
  physical_limitations: string;
  interests: string[];
  dietary_restrictions: string[];
  dining_style: 'adventurous' | 'mixed' | 'familiar';
  budget_tier: 'budget' | 'mid-range' | 'upscale' | 'luxury';
  itinerary_pace: 'relaxed' | 'balanced' | 'packed';
  // Step 4 — Destination & Purpose
  destination: string;
  destinationCountry: string;
  departureCity: string;
  startDate: string;
  endDate: string;
  durationDays: string;
  purpose: Purpose | '';
  purposeNotes: string;
  // Step 5 — Discovery
  classicPct: number;
  destinationVisits: number;
  mustSees: string[];
  alreadyDone: string[];
  discoveryNotes: string;
}

const EMPTY: WizardData = {
  clientId: '',
  travelers: [{ role: 'primary', age_group: '40s', notes: '' }],
  daily_walking: 'medium', activity_level: 'moderate', physical_limitations: '',
  interests: [], dietary_restrictions: [], dining_style: 'mixed',
  budget_tier: 'upscale', itinerary_pace: 'balanced',
  destination: '', destinationCountry: '', departureCity: '',
  startDate: '', endDate: '', durationDays: '',
  purpose: '', purposeNotes: '',
  classicPct: 50, destinationVisits: 0, mustSees: [], alreadyDone: [], discoveryNotes: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getRatioLabel(pct: number): RatioLabel {
  if (pct >= 70) return 'classic-leaning';
  if (pct >= 40) return 'balanced';
  if (pct >= 15) return 'mostly-bespoke';
  return 'fully-bespoke';
}

function calcDuration(start: string, end: string) {
  if (!start || !end) return '';
  const diff = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
  return diff > 0 ? String(Math.round(diff) + 1) : '';
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function TagInput({ label, tags, onChange, placeholder }: {
  label: string; tags: string[]; placeholder?: string;
  onChange: (t: string[]) => void;
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
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? 'Type and press Enter'}
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
        <button type="button" onClick={add}
          className="px-3 py-1.5 text-sm bg-slate-100 rounded-md hover:bg-slate-200">Add</button>
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

function ChipSelect<T extends string>({ options, value, onChange, multi, max }: {
  options: { value: T; label: string }[];
  value: T | T[];
  onChange: (v: T | T[]) => void;
  multi?: boolean;
  max?: number;
}) {
  const selected = Array.isArray(value) ? value : [value];
  const toggle = (v: T) => {
    if (!multi) { onChange(v); return; }
    const arr = selected as T[];
    if (arr.includes(v)) { onChange(arr.filter(x => x !== v) as T[]); }
    else if (!max || arr.length < max) { onChange([...arr, v] as T[]); }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(({ value: v, label }) => {
        const active = selected.includes(v);
        return (
          <button key={v} type="button" onClick={() => toggle(v)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors
              ${active ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:border-slate-500'}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ['Client', 'Group', 'Preferences', 'Destination', 'Discovery'];

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
            <div className={`h-px w-6 sm:w-8 mx-2 ${i < current ? 'bg-slate-900' : 'bg-gray-200'}`} />
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
      {clients?.length === 0
        ? <ErrorMessage message="No clients yet. Go to the Clients page and create one first." />
        : (
          <div className="space-y-2 mt-2">
            {clients?.map(client => (
              <button key={client.id} type="button" onClick={() => onChange({ clientId: client.id })}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors
                  ${data.clientId === client.id ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900' : 'border-gray-200 hover:border-slate-400'}`}>
                <p className="font-medium text-gray-900">{client.name}</p>
                <p className="text-sm text-gray-500">{client.email}</p>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}

// ─── Step 2: Group ────────────────────────────────────────────────────────────

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'primary',   label: 'Primary traveler' },
  { value: 'partner',   label: 'Partner / spouse' },
  { value: 'child',     label: 'Child' },
  { value: 'parent',    label: 'Parent' },
  { value: 'sibling',   label: 'Sibling' },
  { value: 'friend',    label: 'Friend' },
  { value: 'colleague', label: 'Colleague' },
];

const AGE_OPTIONS: { value: AgeGroup; label: string }[] = [
  { value: 'young-child', label: '0–5' },
  { value: 'child',       label: '6–12' },
  { value: 'teen',        label: '13–17' },
  { value: '20s',         label: '20s' },
  { value: '30s',         label: '30s' },
  { value: '40s',         label: '40s' },
  { value: '50s',         label: '50s' },
  { value: '60s',         label: '60s' },
  { value: '70s+',        label: '70s+' },
];

function TravelerCard({ traveler, index, onChange, onRemove, canRemove }: {
  traveler: Traveler; index: number;
  onChange: (t: Traveler) => void; onRemove: () => void; canRemove: boolean;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">Traveler {index + 1}</p>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-xs text-red-400 hover:text-red-600">Remove</button>
        )}
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Role</p>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_OPTIONS.map(({ value, label }) => (
            <button key={value} type="button" onClick={() => onChange({ ...traveler, role: value })}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors
                ${traveler.role === value ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:border-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Age group</p>
        <div className="flex flex-wrap gap-1.5">
          {AGE_OPTIONS.map(({ value, label }) => (
            <button key={value} type="button" onClick={() => onChange({ ...traveler, age_group: value })}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors
                ${traveler.age_group === value ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:border-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <input value={traveler.notes} onChange={e => onChange({ ...traveler, notes: e.target.value })}
          placeholder="Any notes (e.g. uses walking stick, very active)"
          className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-500" />
      </div>
    </div>
  );
}

function StepGroup({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  const update = (i: number, t: Traveler) => {
    const travelers = [...data.travelers];
    travelers[i] = t;
    onChange({ travelers });
  };
  const remove = (i: number) => onChange({ travelers: data.travelers.filter((_, idx) => idx !== i) });
  const add = () => onChange({ travelers: [...data.travelers, { role: 'partner', age_group: '40s', notes: '' }] });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Who's traveling?</h2>
        <p className="text-sm text-gray-500 mt-1">Add everyone on the trip. This shapes activity and restaurant recommendations.</p>
      </div>
      {data.travelers.map((t, i) => (
        <TravelerCard key={i} traveler={t} index={i}
          onChange={t => update(i, t)}
          onRemove={() => remove(i)}
          canRemove={data.travelers.length > 1} />
      ))}
      {data.travelers.length < 8 && (
        <button type="button" onClick={add}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-slate-400 hover:text-slate-700 transition-colors">
          + Add another traveler
        </button>
      )}
    </div>
  );
}

// ─── Step 3: Preferences ──────────────────────────────────────────────────────

const INTERESTS: { value: string; label: string }[] = [
  { value: 'food-wine',         label: '🍷 Food & wine' },
  { value: 'art-museums',       label: '🎨 Art & museums' },
  { value: 'architecture',      label: '🏛️ Architecture' },
  { value: 'history',           label: '📜 History' },
  { value: 'outdoor-nature',    label: '🌿 Outdoor & nature' },
  { value: 'markets',           label: '🛒 Markets' },
  { value: 'music-performance', label: '🎭 Music & performance' },
  { value: 'shopping',          label: '🛍️ Shopping' },
  { value: 'cooking-classes',   label: '👨‍🍳 Cooking classes' },
  { value: 'beaches',           label: '🏖️ Beaches' },
  { value: 'sports',            label: '🚴 Sports & activities' },
];

function StepPreferences({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Trip preferences</h2>
        <p className="text-sm text-gray-500 mt-1">These guide activity selection and daily scheduling.</p>
      </div>

      {/* Walking & Activity */}
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Daily walking capacity</p>
          <ChipSelect
            options={[
              { value: 'low' as const,    label: 'Low — under 3 km' },
              { value: 'medium' as const, label: 'Medium — 3–6 km' },
              { value: 'high' as const,   label: 'High — 6 km+' },
            ]}
            value={data.daily_walking}
            onChange={v => onChange({ daily_walking: v as 'low' | 'medium' | 'high' })}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Activity level</p>
          <ChipSelect
            options={[
              { value: 'relaxed' as const,  label: 'Relaxed — gentle pace, lots of downtime' },
              { value: 'moderate' as const, label: 'Moderate — mix of active and leisurely' },
              { value: 'active' as const,   label: 'Active — hiking, cycling, full days' },
            ]}
            value={data.activity_level}
            onChange={v => onChange({ activity_level: v as 'relaxed' | 'moderate' | 'active' })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Physical limitations <span className="text-gray-400 font-normal">(optional)</span></label>
          <input value={data.physical_limitations} onChange={e => onChange({ physical_limitations: e.target.value })}
            placeholder="e.g. bad knees — avoid stairs, no steep hills"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
        </div>
      </div>

      {/* Interests */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-700 mb-1">Interests <span className="text-gray-400 font-normal">— pick up to 4</span></p>
        <p className="text-xs text-gray-400 mb-3">These rank what types of activities to prioritise in research.</p>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map(({ value, label }) => {
            const active = data.interests.includes(value);
            const maxed = data.interests.length >= 4 && !active;
            return (
              <button key={value} type="button"
                onClick={() => {
                  if (active) onChange({ interests: data.interests.filter(i => i !== value) });
                  else if (!maxed) onChange({ interests: [...data.interests, value] });
                }}
                disabled={maxed}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors
                  ${active ? 'bg-slate-900 text-white border-slate-900' : maxed ? 'border-gray-200 text-gray-300 cursor-not-allowed' : 'border-gray-300 text-gray-600 hover:border-slate-500'}`}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dining */}
      <div className="border-t border-gray-100 pt-4 space-y-4">
        <p className="text-sm font-medium text-gray-700">Dining</p>
        <div>
          <p className="text-xs text-gray-500 mb-2">Style</p>
          <ChipSelect
            options={[
              { value: 'adventurous' as const, label: '🌶️ Adventurous — try anything local' },
              { value: 'mixed' as const,        label: '⚖️ Mixed — mostly local, some familiar' },
              { value: 'familiar' as const,     label: '🏠 Familiar — prefer recognisable cuisine' },
            ]}
            value={data.dining_style}
            onChange={v => onChange({ dining_style: v as 'adventurous' | 'mixed' | 'familiar' })}
          />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2">Budget tier</p>
          <ChipSelect
            options={[
              { value: 'budget' as const,    label: '$ Budget' },
              { value: 'mid-range' as const, label: '$$ Mid-range' },
              { value: 'upscale' as const,   label: '$$$ Upscale' },
              { value: 'luxury' as const,    label: '$$$$ Luxury' },
            ]}
            value={data.budget_tier}
            onChange={v => onChange({ budget_tier: v as 'budget' | 'mid-range' | 'upscale' | 'luxury' })}
          />
        </div>
        <TagInput label="Dietary restrictions & allergies"
          tags={data.dietary_restrictions}
          onChange={dietary_restrictions => onChange({ dietary_restrictions })}
          placeholder="e.g. shellfish allergy, vegetarian" />
      </div>

      {/* Pace */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Itinerary pace</p>
        <ChipSelect
          options={[
            { value: 'relaxed' as const,  label: 'Relaxed — 2–3 things per day' },
            { value: 'balanced' as const, label: 'Balanced — 3–4 per day' },
            { value: 'packed' as const,   label: 'Packed — 5+ per day' },
          ]}
          value={data.itinerary_pace}
          onChange={v => onChange({ itinerary_pace: v as 'relaxed' | 'balanced' | 'packed' })}
        />
      </div>
    </div>
  );
}

// ─── Step 4: Destination & Purpose ────────────────────────────────────────────

const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: 'anniversary',      label: '💑 Anniversary' },
  { value: 'honeymoon',        label: '🥂 Honeymoon' },
  { value: 'vacation',         label: '🌴 Vacation' },
  { value: 'birthday',         label: '🎂 Birthday' },
  { value: 'family',           label: '👨‍👩‍👧 Family trip' },
  { value: 'business-leisure', label: '💼 Business + leisure' },
  { value: 'solo-exploration', label: '🧭 Solo exploration' },
  { value: 'other',            label: '✈️ Other' },
];

function StepDestination({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  const tf = (label: string, key: keyof WizardData, placeholder: string, required = false) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal">(optional)</span>}
      </label>
      <input value={data[key] as string} onChange={e => onChange({ [key]: e.target.value })} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
    </div>
  );
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Destination & occasion</h2>
        <p className="text-sm text-gray-500 mt-1">Where are they going and what's the trip for?</p>
      </div>
      {tf('Destination', 'destination', 'Barcelona, Spain', true)}
      {tf('Country', 'destinationCountry', 'Spain', true)}
      {tf('Departure city', 'departureCity', 'New York')}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start date <span className="text-gray-400 font-normal">(optional)</span></label>
          <input type="date" value={data.startDate}
            onChange={e => { const s = e.target.value; onChange({ startDate: s, durationDays: calcDuration(s, data.endDate) }); }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End date <span className="text-gray-400 font-normal">(optional)</span></label>
          <input type="date" value={data.endDate}
            onChange={e => { const e2 = e.target.value; onChange({ endDate: e2, durationDays: calcDuration(data.startDate, e2) }); }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
        </div>
      </div>
      {data.durationDays && <p className="text-sm text-slate-600 font-medium">{data.durationDays} days</p>}

      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Occasion <span className="text-red-500">*</span></p>
        <div className="grid grid-cols-2 gap-2">
          {PURPOSE_OPTIONS.map(({ value, label }) => (
            <button key={value} type="button" onClick={() => onChange({ purpose: value })}
              className={`text-left px-4 py-3 rounded-lg border text-sm transition-colors
                ${data.purpose === value ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 font-medium' : 'border-gray-200 hover:border-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Purpose notes <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea value={data.purposeNotes} onChange={e => onChange({ purposeNotes: e.target.value })}
          rows={2} placeholder="e.g. First stop of a cruise. Wife's 40th birthday."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none" />
      </div>
    </div>
  );
}

// ─── Step 5: Discovery ────────────────────────────────────────────────────────

const RATIO_LABELS: Record<RatioLabel, string> = {
  'classic-leaning': 'Classic-leaning — famous landmarks with a few local gems',
  'balanced':        'Balanced — mix of iconic sights and off-the-beaten-path',
  'mostly-bespoke':  'Mostly bespoke — local favourites, minimal tourist crowds',
  'fully-bespoke':   'Fully bespoke — hidden gems only, nothing in the guidebooks',
};

function StepDiscovery({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  const label = getRatioLabel(data.classicPct);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Discovery profile</h2>
        <p className="text-sm text-gray-500 mt-1">How should we balance the itinerary?</p>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Times visited {data.destination || 'this destination'}</p>
        <div className="flex items-center gap-3">
          {[0, 1, 2, 3, '4+'].map(n => (
            <button key={n} type="button"
              onClick={() => onChange({ destinationVisits: n === '4+' ? 4 : Number(n) })}
              className={`w-11 h-11 rounded-full border text-sm font-medium transition-colors
                ${data.destinationVisits === (n === '4+' ? 4 : Number(n)) ? 'border-slate-900 bg-slate-900 text-white' : 'border-gray-300 hover:border-slate-500'}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>🏛️ Classic ({data.classicPct}%)</span>
          <span>🗺️ Bespoke ({100 - data.classicPct}%)</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={data.classicPct}
          onChange={e => onChange({ classicPct: Number(e.target.value) })}
          className="w-full accent-slate-900" />
        <p className="mt-2 text-sm text-slate-700 font-medium">{RATIO_LABELS[label]}</p>
      </div>
      <TagInput label="Must-sees" tags={data.mustSees} onChange={mustSees => onChange({ mustSees })}
        placeholder="e.g. Casa Batlló exterior" />
      {data.destinationVisits > 0 && (
        <TagInput label="Already done (skip these)" tags={data.alreadyDone}
          onChange={alreadyDone => onChange({ alreadyDone })}
          placeholder="e.g. Sagrada Família interior" />
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea value={data.discoveryNotes} onChange={e => onChange({ discoveryNotes: e.target.value })}
          rows={2} placeholder="e.g. Client wants to avoid very touristy restaurants."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none" />
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

  const canAdvance = () => {
    if (step === 0) return !!data.clientId;
    if (step === 1) return data.travelers.length > 0;
    if (step === 2) return data.interests.length > 0;
    if (step === 3) return !!(data.destination && data.destinationCountry && data.purpose);
    return true;
  };

  const mutation = useMutation({
    mutationFn: () => apiFetch<{ id: string }>('/trips', {
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
          previously_seen:    [],
          ratio_classic_pct:  data.classicPct,
          ratio_hidden_pct:   100 - data.classicPct,
          ratio_label:        getRatioLabel(data.classicPct),
          must_sees:          data.mustSees,
          already_done:       data.alreadyDone,
          notes:              data.discoveryNotes,
        },
        travelerProfile: {
          travelers:            data.travelers,
          daily_walking:        data.daily_walking,
          activity_level:       data.activity_level,
          physical_limitations: data.physical_limitations,
          interests:            data.interests,
          dietary_restrictions: data.dietary_restrictions,
          dining_style:         data.dining_style,
          budget_tier:          data.budget_tier,
          itinerary_pace:       data.itinerary_pace,
        },
      }),
    }),
    onSuccess: trip => navigate(`/trips/${trip.id}`),
    onError: (err: Error) => setSubmitError(err.message),
  });

  const steps = [
    <StepClient      key={0} data={data} onChange={update} />,
    <StepGroup       key={1} data={data} onChange={update} />,
    <StepPreferences key={2} data={data} onChange={update} />,
    <StepDestination key={3} data={data} onChange={update} />,
    <StepDiscovery   key={4} data={data} onChange={update} />,
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">New trip</h1>
      </div>
      <StepIndicator current={step} />
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        {steps[step]}
        {submitError && <div className="mt-4"><ErrorMessage message={submitError} /></div>}
        <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
          <button type="button"
            onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          {step < 4 ? (
            <button type="button" onClick={() => setStep(s => s + 1)} disabled={!canAdvance()}
              className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-40 transition-colors">
              Continue →
            </button>
          ) : (
            <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-40 transition-colors">
              {mutation.isPending ? 'Creating…' : 'Create trip'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
