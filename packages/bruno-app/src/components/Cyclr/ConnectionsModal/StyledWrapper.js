import styled from 'styled-components';

const StyledWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  font-size: ${(props) => props.theme.font.size.sm};

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    h3 {
      font-weight: 600;
    }
  }

  .hint {
    margin: 0.25rem 0 0.5rem;
    font-size: 0.75rem;
    color: ${(props) => props.theme.dropdown.mutedText};
  }

  .rows {
    border: 1px solid ${(props) => props.theme.border.border1};
    border-radius: ${(props) => props.theme.border.radius.base};
    &:empty {
      display: none;
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.625rem;
    & + .row,
    & + form,
    form + & {
      border-top: 1px solid ${(props) => props.theme.border.border1};
    }
  }

  .name {
    font-weight: 500;
    white-space: nowrap;
  }

  .warn {
    color: ${(props) => props.theme.colors.text.warning};
    border-color: ${(props) => props.theme.colors.text.warning};
  }

  code {
    font-size: 0.6875rem;
  }

  .muted {
    color: ${(props) => props.theme.dropdown.mutedText};
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
  }

  .truncate {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 0.625rem;
  }

  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.6875rem;
    border: 1px solid ${(props) => props.theme.border.border2};
  }

  .actions {
    margin-left: auto;
    display: inline-flex;
    gap: 0.25rem;
    button {
      padding: 0.2rem;
      border-radius: ${(props) => props.theme.border.radius.sm};
      color: ${(props) => props.theme.dropdown.iconColor};
      &:hover:not(:disabled) {
        background: ${(props) => props.theme.dropdown.hoverBg};
      }
      &:disabled {
        opacity: 0.4;
      }
    }
  }

  .textbox {
    padding: 0.3rem 0.5rem;
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: ${(props) => props.theme.border.radius.base};
    background: ${(props) => props.theme.input.bg};
    outline: none;
    &:focus {
      border-color: ${(props) => props.theme.input.focusBorder};
    }
  }

  .inline-form {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    .grow {
      flex: 1;
    }
  }

  .partner-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 0.75rem;
    padding: 0.625rem;
    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      span {
        font-size: 0.75rem;
        color: ${(props) => props.theme.dropdown.mutedText};
      }
    }
    &.single {
      grid-template-columns: 1fr;
      padding: 0;
    }
    .full {
      grid-column: 1 / -1;
    }
    .form-actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  }

  .cache {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    .hint {
      margin: 0;
    }
  }
`;

export default StyledWrapper;
