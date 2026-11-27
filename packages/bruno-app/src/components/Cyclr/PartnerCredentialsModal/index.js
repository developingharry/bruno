import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import Portal from 'components/Portal';
import Modal from 'components/Modal';
import { saveCyclrPartnerCredentials, testCyclrPartner } from 'providers/ReduxStore/slices/cyclr';
import StyledWrapper from '../ConnectionsModal/StyledWrapper';

/**
 * Partner-level OAuth credentials for one partner on one stack. The admin webhook only
 * lists partners, so these are entered once per partner and stored encrypted.
 */
const PartnerCredentialsModal = ({ stackId, partner, onClose }) => {
  const dispatch = useDispatch();
  const stack = useSelector((state) => state.cyclr.config.stacks.find((s) => s.id === stackId));
  const existing = useSelector((state) =>
    state.cyclr.config.credentials.find((c) => c.stackId === stackId && String(c.partnerId) === String(partner.id))
  );
  const [clientId, setClientId] = useState(existing?.clientId || '');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await dispatch(
        saveCyclrPartnerCredentials({ stackId, partnerId: partner.id, partnerName: partner.label, clientId, clientSecret })
      );
      try {
        await dispatch(testCyclrPartner({ stackId, partnerId: partner.id }));
        toast.success(`Connected to ${partner.label}`);
      } catch (err) {
        toast.error(`Saved, but the credentials didn't work: ${err.message}`);
      }
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal>
      <Modal
        size="md"
        title={`API credentials · ${partner.label}`}
        confirmText={saving ? 'Saving…' : 'Save & test'}
        handleConfirm={save}
        handleCancel={onClose}
        confirmDisabled={saving || !clientId.trim() || (!existing?.hasSecret && !clientSecret)}
      >
        <StyledWrapper>
          <p className="hint">
            Partner API client credentials for <strong>{partner.label}</strong> (ID {partner.id}) on the {stack?.name || stackId} stack.
            The secret is encrypted with your OS keychain.
          </p>
          <div className="partner-form single">
            <label>
              <span>Client ID</span>
              <input className="textbox mono" value={clientId} autoFocus spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
            </label>
            <label>
              <span>Client secret</span>
              <input
                className="textbox mono"
                type="password"
                value={clientSecret}
                autoComplete="off"
                placeholder={existing?.hasSecret ? 'Saved - leave blank to keep it' : ''}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </label>
          </div>
        </StyledWrapper>
      </Modal>
    </Portal>
  );
};

export default PartnerCredentialsModal;
