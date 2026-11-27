import styled from 'styled-components';

const StyledWrapper = styled.div`
  width: 380px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  color: ${(props) => props.theme.dropdown.color};

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.625rem 0.25rem;
  }

  .picker-title {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.025em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem;
    border-radius: ${(props) => props.theme.border.radius.sm};
    color: ${(props) => props.theme.dropdown.iconColor};
    &:hover:not(:disabled) {
      background: ${(props) => props.theme.dropdown.hoverBg};
    }
    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  .spin {
    animation: cyclr-spin 0.9s linear infinite;
  }
  @keyframes cyclr-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0.25rem 0.625rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: ${(props) => props.theme.border.radius.base};
    background: ${(props) => props.theme.input.bg};
    color: ${(props) => props.theme.dropdown.iconColor};

    &:focus-within {
      border-color: ${(props) => props.theme.input.focusBorder};
    }

    input {
      flex: 1;
      min-width: 0;
      background: transparent;
      outline: none;
      border: none;
      color: ${(props) => props.theme.dropdown.color};
      font-size: ${(props) => props.theme.font.size.sm};
    }
  }

  .picker-status {
    padding: 0.125rem 0.625rem 0.375rem;
    font-size: 0.6875rem;
    color: ${(props) => props.theme.dropdown.mutedText};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-error {
    color: ${(props) => props.theme.colors.text.danger};
  }

  .picker-empty {
    padding: 0.75rem 0.625rem 1rem;
    color: ${(props) => props.theme.dropdown.mutedText};
  }

  .picker-row {
    height: 44px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.625rem;
    cursor: pointer;

    &.active {
      background: ${(props) => props.theme.dropdown.hoverBg};
    }
    &.selected .row-label {
      color: ${(props) => props.theme.dropdown.selectedColor};
      font-weight: 500;
    }
  }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }

  .row-label,
  .row-sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-sub {
    font-size: 0.6875rem;
    color: ${(props) => props.theme.dropdown.mutedText};
  }

  .row-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .row-check {
    flex-shrink: 0;
    color: ${(props) => props.theme.dropdown.selectedColor};
  }

  .picker-footer {
    border-top: 1px solid ${(props) => props.theme.dropdown.separator};
    padding: 0.25rem 0.625rem;
  }

  .text-btn {
    font-size: 0.75rem;
    color: ${(props) => props.theme.dropdown.mutedText};
    padding: 0.25rem 0;
    &:hover {
      color: ${(props) => props.theme.dropdown.color};
      text-decoration: underline;
    }
  }
`;

export default StyledWrapper;
