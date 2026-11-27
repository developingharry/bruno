import styled from 'styled-components';

const StyledWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.5rem;
  font-size: ${(props) => props.theme.font.size.sm};

  .divider {
    width: 1px;
    height: 1rem;
    margin: 0 0.125rem;
    background: ${(props) => props.theme.border.border1};
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 260px;
    padding: 0.2rem 0.5rem;
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: 999px;
    color: ${(props) => props.theme.dropdown.mutedText};
    background: transparent;
    line-height: 1.2;
    white-space: nowrap;

    &:hover:not(:disabled),
    &.open {
      border-color: ${(props) => props.theme.input.focusBorder};
      color: ${(props) => props.theme.dropdown.color};
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    &.has-value .chip-value {
      color: ${(props) => props.theme.dropdown.color};
      font-weight: 500;
    }

    &.needs-value {
      border-style: dashed;
      border-color: ${(props) => props.theme.dropdown.selectedColor};
      color: ${(props) => props.theme.dropdown.selectedColor};
    }
  }

  .icon-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.4rem;
    border-radius: 999px;
    color: ${(props) => props.theme.dropdown.iconColor};
    &:hover {
      background: ${(props) => props.theme.dropdown.hoverBg};
      color: ${(props) => props.theme.dropdown.color};
    }
    &.warn {
      border: 1px dashed ${(props) => props.theme.colors.text.warning};
      color: ${(props) => props.theme.colors.text.warning};
    }
  }

  .chip-label {
    font-size: 0.6875rem;
    opacity: 0.8;
  }

  .chip-value {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

export default StyledWrapper;
