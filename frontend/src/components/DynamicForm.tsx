import { FormEvent, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolField, ToolInfo } from '../types';

type Values = Record<string, unknown>;
type Files = Record<string, File[]>;

function defaultValue(field: ToolField) {
  if (field.default !== undefined) return field.default;
  if (field.type === 'checkbox') return false;
  return '';
}

// ── ARCA filename validation ──────────────────────────────────────────────────
const CUIL_RE = /\d{11}/;

function validateArcaFiles(fileList: FileList | null): { files: File[]; error: string } {
  if (!fileList || fileList.length === 0) return { files: [], error: '' };
  const files = Array.from(fileList);
  const invalid = files.filter((f) => {
    const name = f.name.toLowerCase();
    const hasType = name.includes('emitidos') || name.includes('recibidos');
    const hasCuil = CUIL_RE.test(f.name);
    return !hasType || !hasCuil;
  });
  if (invalid.length > 0) {
    return {
      files: [],
      error: `Nombre inválido: ${invalid.map((f) => f.name).join(', ')}. Cada archivo debe tener "emitidos" o "recibidos" y un CUIT en el nombre.`,
    };
  }
  return { files, error: '' };
}

// ── Field grouping ────────────────────────────────────────────────────────────
type Segment =
  | { kind: 'field'; field: ToolField }
  | { kind: 'section'; header: ToolField; children: ToolField[] };

function groupFields(fields: ToolField[]): Segment[] {
  const segments: Segment[] = [];
  let currentSection: { header: ToolField; children: ToolField[] } | null = null;

  for (const field of fields) {
    if (field.type === 'section') {
      if (currentSection) segments.push({ kind: 'section', ...currentSection });
      currentSection = { header: field, children: [] };
    } else if (field.section && currentSection && field.section === currentSection.header.name) {
      currentSection.children.push(field);
    } else {
      if (currentSection) {
        segments.push({ kind: 'section', ...currentSection });
        currentSection = null;
      }
      segments.push({ kind: 'field', field });
    }
  }
  if (currentSection) segments.push({ kind: 'section', ...currentSection });
  return segments;
}

// ── Individual field renderer ─────────────────────────────────────────────────
function FieldRenderer({
  field,
  values,
  files,
  fileErrors,
  setValues,
  setFiles,
  setFileErrors,
  disabled,
}: {
  field: ToolField;
  values: Values;
  files: Files;
  fileErrors: Record<string, string>;
  setValues: (v: Values) => void;
  setFiles: (f: Files) => void;
  setFileErrors: (e: Record<string, string>) => void;
  disabled?: boolean;
}) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={Boolean(values[field.name])}
          disabled={disabled}
          onChange={(e) => setValues({ ...values, [field.name]: e.target.checked })}
        />
        <span>
          <span className="block text-sm font-semibold text-slate-100">{field.label}</span>
          {field.help && <span className="block pt-1 text-xs text-slate-400">{field.help}</span>}
        </span>
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-200">
          {field.label}{field.required && ' *'}
        </span>
        <select
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none focus:border-blue-400"
          value={String(values[field.name] ?? '')}
          disabled={disabled}
          onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
          required={field.required}
        >
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-200">
          {field.label}{field.required && ' *'}
        </span>
        <textarea
          className="min-h-36 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none focus:border-blue-400"
          placeholder={field.placeholder}
          value={String(values[field.name] ?? '')}
          disabled={disabled}
          onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
          required={field.required}
        />
      </label>
    );
  }

  if (field.type === 'file' || field.type === 'multi_file') {
    const err = fileErrors[field.name];
    return (
      <div>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-200">
            {field.label}{field.required && ' *'}
          </span>
          <input
            type="file"
            accept={field.validate_filename === 'arca' ? undefined : field.accept}
            multiple={field.type === 'multi_file'}
            disabled={disabled}
            className={`w-full rounded-xl border border-dashed px-3 py-3 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-2 file:text-white ${
              err ? 'border-red-500 bg-red-500/10' : 'border-slate-600 bg-slate-950'
            }`}
            onChange={(e) => {
              if (field.validate_filename === 'arca') {
                const { files: valid, error } = validateArcaFiles(e.target.files);
                setFileErrors({ ...fileErrors, [field.name]: error });
                if (!error) setFiles({ ...files, [field.name]: valid });
                else {
                  e.target.value = '';
                  setFiles({ ...files, [field.name]: [] });
                }
              } else {
                setFiles({ ...files, [field.name]: Array.from(e.target.files || []) });
              }
            }}
            // No usamos required nativo en file inputs para evitar que el browser
            // bloquee el submit cuando se usa un flujo alternativo (ej: otro rango).
            // La validación real la hace el servidor.
          />
        </label>
        {field.help && !err && <p className="mt-1 text-xs text-slate-400">{field.help}</p>}
        {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
      </div>
    );
  }

  // text / number / date
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-200">
        {field.label}{field.required && ' *'}
      </span>
      <input
        type={field.type}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none focus:border-blue-400"
        placeholder={field.placeholder}
        value={String(values[field.name] ?? '')}
        disabled={disabled}
        onChange={(e) =>
          setValues({ ...values, [field.name]: field.type === 'number' ? Number(e.target.value) : e.target.value })
        }
        required={field.required}
      />
      {field.help && <p className="mt-1 text-xs text-slate-400">{field.help}</p>}
    </label>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────
export function DynamicForm({
  tool,
  disabled,
  onSubmit,
}: {
  tool: ToolInfo;
  disabled?: boolean;
  onSubmit: (values: Values, files: Files) => void;
}) {
  const initial = useMemo(
    () =>
      Object.fromEntries(
        tool.fields
          .filter((f) => f.type !== 'file' && f.type !== 'multi_file' && f.type !== 'section')
          .map((f) => [f.name, defaultValue(f)]),
      ),
    [tool],
  );

  const [values, setValues] = useState<Values>(initial);
  const [files, setFiles] = useState<Files>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  // Track which collapsible sections are open
  const initialOpen = useMemo(() => {
    const state: Record<string, boolean> = {};
    for (const f of tool.fields) {
      if (f.type === 'section' && f.collapsible) {
        state[f.name] = f.default_open ?? false;
      }
    }
    return state;
  }, [tool]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(initialOpen);

  function toggleSection(name: string) {
    setOpenSections((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const segments = useMemo(() => groupFields(tool.fields), [tool]);

  const sharedProps = { values, files, fileErrors, setValues, setFiles, setFileErrors, disabled };

  function submit(event: FormEvent) {
    event.preventDefault();
    const hasErrors = Object.values(fileErrors).some((e) => e);
    if (hasErrors) return;
    onSubmit(values, files);
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl">
      {segments.map((seg) => {
        if (seg.kind === 'field') {
          return <FieldRenderer key={seg.field.name} field={seg.field} {...sharedProps} />;
        }

        // Section
        const { header, children } = seg;
        const isOpen = openSections[header.name] ?? false;

        return (
          <div key={header.name} className="rounded-xl border border-slate-600 bg-slate-950/30 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection(header.name)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-200">{header.label}</span>
                {header.help && !isOpen && (
                  <span className="block text-xs text-slate-400">{header.help}</span>
                )}
              </span>
              {isOpen ? (
                <ChevronDown size={16} className="shrink-0 text-slate-400" />
              ) : (
                <ChevronRight size={16} className="shrink-0 text-slate-400" />
              )}
            </button>

            {isOpen && (
              <div className="space-y-5 border-t border-slate-700 px-4 pb-4 pt-4">
                {children.map((child) => (
                  <FieldRenderer key={child.name} field={child} {...sharedProps} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button
        disabled={disabled || Object.values(fileErrors).some((e) => e)}
        className="w-full rounded-xl bg-blue-500 px-4 py-3 font-bold text-white shadow-lg transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? 'Ejecutando...' : 'Ejecutar herramienta'}
      </button>
    </form>
  );
}
