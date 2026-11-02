import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageCircle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from './ui/button';
import { Select, Textarea } from './ui/primitives';
import { Dialog, DialogContent, DialogFooter } from './ui/overlays';
import { Field } from './common';

interface Template {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
}
interface Rendered {
  phone: string;
  text: string;
  url: string;
  missing: string[];
}

const waUrl = (url: string, text: string) => `${url.split('?')[0]}?text=${encodeURIComponent(text)}`;

/**
 * Picks a WhatsApp template, previews it filled for the lead / customer / booking, and opens
 * WhatsApp (click-to-chat) with the message ready to send. Sending is logged on the record.
 */
export function WhatsAppButton({
  entityType,
  entityId,
  categories,
  size = 'sm',
  label = 'WhatsApp',
}: {
  entityType: 'lead' | 'customer' | 'booking';
  entityId: string;
  categories?: string[];
  size?: 'sm' | 'default';
  label?: string;
}) {
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [templateId, setTemplateId] = React.useState('');
  const [text, setText] = React.useState('');
  const templates = useQuery({
    queryKey: ['whatsapp-templates', 'options'],
    queryFn: () => api.page<Template>('/whatsapp-templates', { pageSize: 100, active: 'true' }),
    enabled: open,
    select: (r) => r.items,
  });
  const list = (templates.data ?? []).filter((t) => !categories || categories.includes(t.category) || t.category === 'general');
  const preview = useQuery({
    queryKey: ['whatsapp-render', templateId, entityType, entityId],
    queryFn: () => api.post<Rendered>(`/whatsapp-templates/${templateId}/render`, { entityType, entityId, log: false }),
    enabled: open && Boolean(templateId),
  });
  React.useEffect(() => {
    if (preview.data) setText(preview.data.text);
  }, [preview.data]);
  React.useEffect(() => {
    if (open && !templateId && list[0]) setTemplateId(list[0].id);
  }, [open, templateId, list]);
  const send = useMutation({
    // The tab is opened synchronously on click (popup blockers allow that), then pointed at WhatsApp.
    mutationFn: async (tab: Window | null) => ({ tab, r: await api.post<Rendered>(`/whatsapp-templates/${templateId}/render`, { entityType, entityId, log: true }) }),
    onSuccess: ({ tab, r }) => {
      const url = waUrl(r.url, text || r.text);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
      toast.success('WhatsApp opened – message logged');
      setOpen(false);
    },
    onError: (e, tab) => {
      tab?.close();
      toast.error(errorMessage(e));
    },
  });
  const onSend = () => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    send.mutate(tab);
  };
  if (!can('crm.read')) return null;
  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <MessageCircle /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Send on WhatsApp" description="Choose a template; you can edit the message before it opens in WhatsApp." className="max-w-xl">
          {templates.isPending ? (
            <p className="text-sm text-muted-foreground">Loading templates…</p>
          ) : !list.length ? (
            <p className="text-sm text-muted-foreground">No WhatsApp templates yet. Add them under Pre Sales → WhatsApp Templates.</p>
          ) : (
            <>
              <Field label="Template" htmlFor="wa-template">
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {titleCase(t.category)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={`Message${preview.data?.phone ? ` to ${preview.data.phone}` : ''}`}
                htmlFor="wa-text"
                hint={preview.data?.missing.length ? `Not available for this record: ${preview.data.missing.join(', ')}` : undefined}
              >
                <Textarea rows={7} value={preview.isFetching ? 'Preparing…' : text} onChange={(e) => setText(e.target.value)} />
              </Field>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={send.isPending} disabled={!templateId || !text || preview.isFetching} onClick={onSend}>
              <Send /> Open WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
