import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { IconPencil, IconTrash, IconPlus, IconPlugConnected } from '@tabler/icons';
import Portal from 'components/Portal';
import Modal from 'components/Modal';
import Button from 'ui/Button';
import {
  saveCyclrStack,
  deleteCyclrStack,
  deleteCyclrPartnerCredentials,
  testCyclrPartner,
  clearCyclrCache
} from 'providers/ReduxStore/slices/cyclr';
import PartnerCredentialsModal from '../PartnerCredentialsModal';
import StyledWrapper from './StyledWrapper';

const StackForm = ({ initial, onDone }) => {
  const dispatch = useDispatch();
  const [form, setForm] = useState({
    name: initial?.name || '',
    baseUrl: initial?.baseUrl || 'https://',
    webhookId: initial?.webhookId || ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await dispatch(saveCyclrStack({ id: initial?.id, ...form }));
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="partner-form" onSubmit={submit}>
      <label>
        <span>Name</span>
        <input className="textbox" value={form.name} autoFocus placeholder="UK" onChange={set('name')} />
      </label>
      <label>
        <span>Admin webhook ID (or full URL)</span>
        <input className="textbox mono" value={form.webhookId} placeholder="nWHjlB" spellCheck={false} onChange={set('webhookId')} />
      </label>
      <label className="full">
        <span>Partner API base URL</span>
        <input className="textbox mono" value={form.baseUrl} placeholder="https://api.cyclr.uk" spellCheck={false} onChange={set('baseUrl')} />
      </label>
      <div className="form-actions">
        <Button size="sm" variant="ghost" color="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" loading={saving}>Save</Button>
      </div>
    </form>
  );
};

const ConnectionsModal = ({ onClose }) => {
  const dispatch = useDispatch();
  const { stacks, credentials } = useSelector((state) => state.cyclr.config);
  const [editingStack, setEditingStack] = useState(null); // null | 'new' | stack
  const [editingCred, setEditingCred] = useState(null);
  const [testing, setTesting] = useState(null);

  const confirmAnd = (message, fn) => async () => {
    if (!window.confirm(message)) return;
    try {
      await fn();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const test = async (cred) => {
    const key = `${cred.stackId}:${cred.partnerId}`;
    setTesting(key);
    try {
      await dispatch(testCyclrPartner({ stackId: cred.stackId, partnerId: cred.partnerId }));
      toast.success(`${cred.partnerName}: credentials OK`);
    } catch (err) {
      toast.error(`${cred.partnerName}: ${err.message}`);
    } finally {
      setTesting(null);
    }
  };

  const stackName = (id) => stacks.find((s) => s.id === id)?.name || id;

  return (
    <Portal>
      <Modal size="lg" title="Cyclr settings" hideFooter handleCancel={onClose}>
        <StyledWrapper>
          <section>
            <div className="section-head">
              <h3>Stacks</h3>
              {editingStack !== 'new' && (
                <Button size="sm" variant="outline" icon={<IconPlus size={14} />} onClick={() => setEditingStack('new')}>
                  Add stack
                </Button>
              )}
            </div>
            <p className="hint">
              Each stack has a partner API base URL and an admin webhook that lists its partners
              (<code>{'{"requesttype":"listpartners"}'}</code>).
            </p>
            {editingStack === 'new' && <div className="rows"><StackForm onDone={() => setEditingStack(null)} /></div>}
            <div className="rows">
              {stacks.map((s) =>
                editingStack?.id === s.id ? (
                  <StackForm key={s.id} initial={s} onDone={() => setEditingStack(null)} />
                ) : (
                  <div key={s.id} className="row">
                    <span className="name">{s.name}</span>
                    <span className={`mono truncate ${s.baseUrl ? 'muted' : 'warn'}`}>{s.baseUrl || 'Base URL not set'}</span>
                    <span className={`badge ${s.webhookId ? '' : 'warn'}`} title="Admin webhook">{s.webhookId || 'no webhook'}</span>
                    <span className="actions">
                      <button type="button" title="Edit" onClick={() => setEditingStack(s)}>
                        <IconPencil size={15} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={confirmAnd(`Delete stack "${s.name}" and its saved partner credentials?`, () => dispatch(deleteCyclrStack(s.id)))}
                      >
                        <IconTrash size={15} strokeWidth={1.75} />
                      </button>
                    </span>
                  </div>
                )
              )}
            </div>
          </section>

          <section>
            <div className="section-head">
              <h3>Saved partner credentials</h3>
            </div>
            <p className="hint">
              Added when you first pick a partner. Secrets are encrypted with your OS keychain and only leave this
              machine to request a token from the partner's stack.
            </p>
            <div className="rows">
              {credentials.map((c) => {
                const key = `${c.stackId}:${c.partnerId}`;
                return (
                  <div key={key} className="row">
                    <span className="badge">{stackName(c.stackId)}</span>
                    <span className="name">{c.partnerName}</span>
                    <span className="muted mono truncate">{c.clientId}</span>
                    <span className="actions">
                      <button type="button" title="Test credentials" onClick={() => test(c)} disabled={testing === key}>
                        <IconPlugConnected size={15} strokeWidth={1.75} />
                      </button>
                      <button type="button" title="Edit" onClick={() => setEditingCred(c)}>
                        <IconPencil size={15} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={confirmAnd(`Delete saved credentials for "${c.partnerName}"?`, () =>
                          dispatch(deleteCyclrPartnerCredentials({ stackId: c.stackId, partnerId: c.partnerId })))}
                      >
                        <IconTrash size={15} strokeWidth={1.75} />
                      </button>
                    </span>
                  </div>
                );
              })}
              {!credentials.length && <div className="muted empty">None yet.</div>}
            </div>
          </section>

          <section className="cache">
            <span className="hint">Dropdown lists are cached on disk and refreshed in the background when they go stale.</span>
            <Button
              size="sm"
              variant="ghost"
              color="secondary"
              onClick={async () => {
                await dispatch(clearCyclrCache());
                toast.success('Cyclr list cache cleared');
              }}
            >
              Clear list cache
            </Button>
          </section>
        </StyledWrapper>
      </Modal>
      {editingCred && (
        <PartnerCredentialsModal
          stackId={editingCred.stackId}
          partner={{ id: editingCred.partnerId, label: editingCred.partnerName }}
          onClose={() => setEditingCred(null)}
        />
      )}
    </Portal>
  );
};

export default ConnectionsModal;
