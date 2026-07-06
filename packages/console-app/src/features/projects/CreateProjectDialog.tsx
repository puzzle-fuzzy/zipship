import type { FormEvent } from 'react';
import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Input } from '../../shared/ui/Input';

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: { name: string; slug: string; description: string }) => void;
}

export function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    if (!slug.trim()) {
      setError('Project slug is required');
      return;
    }

    setLoading(true);
    try {
      onCreated({ name: name.trim(), slug: slug.trim(), description: description.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    const generated = value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    setSlug(generated);
  };

  return (
    <Dialog open={open} title="New Project" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div
            style={{
              padding: '8px 12px',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-error)',
              background: 'var(--color-error-bg)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {error}
          </div>
        )}
        <Input label="Project name" placeholder="My Project" value={name} onChange={handleNameChange} />
        <Input label="Slug" placeholder="my-project" value={slug} onChange={setSlug} hint="URL-friendly identifier" />
        <Input
          label="Description (optional)"
          placeholder="What is this project for?"
          value={description}
          onChange={setDescription}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading || !name.trim() || !slug.trim()}>
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
