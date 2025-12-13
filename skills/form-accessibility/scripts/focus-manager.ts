/**
 * Focus Manager
 * 
 * Utilities for managing focus in forms, including:
 * - Focus on first error after submit
 * - Focus trap for modals
 * - Skip links
 * - Step change focus (multi-step forms)
 * 
 * @module focus-manager
 */

// =============================================================================
// TYPES
// =============================================================================

export interface FocusableElement extends HTMLElement {
  focus(options?: FocusOptions): void;
}

export interface FocusTrapOptions {
  /** Element to trap focus within */
  container: HTMLElement;
  
  /** Initial element to focus (defaults to first focusable) */
  initialFocus?: HTMLElement | null;
  
  /** Element to return focus to on deactivation */
  returnFocus?: HTMLElement | null;
  
  /** Callback when escape is pressed */
  onEscape?: () => void;
  
  /** Whether to allow focus to leave trap via click outside */
  clickOutsideDeactivates?: boolean;
}

export interface FocusTrap {
  /** Activate the focus trap */
  activate: () => void;
  
  /** Deactivate and return focus */
  deactivate: () => void;
  
  /** Check if trap is active */
  isActive: () => boolean;
}

// =============================================================================
// FOCUSABLE ELEMENTS
// =============================================================================

/**
 * Selector for all focusable elements
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(', ');

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): FocusableElement[] {
  const elements = container.querySelectorAll(FOCUSABLE_SELECTOR);
  return Array.from(elements).filter((el) => {
    // Filter out elements that are not visible
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }) as FocusableElement[];
}

/**
 * Get the first focusable element in a container
 */
export function getFirstFocusable(container: HTMLElement): FocusableElement | null {
  const elements = getFocusableElements(container);
  return elements[0] || null;
}

/**
 * Get the last focusable element in a container
 */
export function getLastFocusable(container: HTMLElement): FocusableElement | null {
  const elements = getFocusableElements(container);
  return elements[elements.length - 1] || null;
}

// =============================================================================
// FOCUS ON ERROR
// =============================================================================

/**
 * Focus the first invalid field in a form
 * 
 * @example
 * ```tsx
 * function handleSubmit(e) {
 *   e.preventDefault();
 *   const hasErrors = validate();
 *   if (hasErrors) {
 *     focusFirstError(formRef.current);
 *     return;
 *   }
 *   submit();
 * }
 * ```
 */
export function focusFirstError(form: HTMLFormElement | null): boolean {
  if (!form) return false;
  
  // Try aria-invalid first (most reliable)
  const invalidField = form.querySelector('[aria-invalid="true"]') as FocusableElement | null;
  if (invalidField) {
    invalidField.focus({ preventScroll: false });
    // Ensure field is scrolled into view
    invalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  
  // Try :invalid pseudo-class (native validation)
  const nativeInvalid = form.querySelector(':invalid:not(fieldset)') as FocusableElement | null;
  if (nativeInvalid) {
    nativeInvalid.focus({ preventScroll: false });
    nativeInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  
  // Try error class (fallback)
  const errorField = form.querySelector('.form-field--error input, .form-field--error select, .form-field--error textarea') as FocusableElement | null;
  if (errorField) {
    errorField.focus({ preventScroll: false });
    errorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  
  return false;
}

/**
 * Get all invalid fields in a form
 */
export function getInvalidFields(form: HTMLFormElement): FocusableElement[] {
  const fields: FocusableElement[] = [];
  
  // aria-invalid
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    fields.push(el as FocusableElement);
  });
  
  // :invalid pseudo-class
  form.querySelectorAll(':invalid:not(fieldset)').forEach((el) => {
    if (!fields.includes(el as FocusableElement)) {
      fields.push(el as FocusableElement);
    }
  });
  
  return fields;
}

// =============================================================================
// FOCUS TRAP
// =============================================================================

/**
 * Create a focus trap for modal dialogs and overlays
 * 
 * @example
 * ```tsx
 * function Modal({ isOpen, onClose, children }) {
 *   const modalRef = useRef<HTMLDivElement>(null);
 *   const trapRef = useRef<FocusTrap | null>(null);
 *   
 *   useEffect(() => {
 *     if (isOpen && modalRef.current) {
 *       trapRef.current = createFocusTrap({
 *         container: modalRef.current,
 *         onEscape: onClose
 *       });
 *       trapRef.current.activate();
 *     }
 *     
 *     return () => trapRef.current?.deactivate();
 *   }, [isOpen, onClose]);
 *   
 *   return isOpen ? <div ref={modalRef}>{children}</div> : null;
 * }
 * ```
 */
export function createFocusTrap(options: FocusTrapOptions): FocusTrap {
  const {
    container,
    initialFocus,
    returnFocus,
    onEscape,
    clickOutsideDeactivates = false
  } = options;
  
  let active = false;
  let previousFocus: HTMLElement | null = null;
  
  function handleKeyDown(event: KeyboardEvent) {
    if (!active) return;
    
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      onEscape();
      return;
    }
    
    if (event.key !== 'Tab') return;
    
    const focusableElements = getFocusableElements(container);
    if (focusableElements.length === 0) return;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    // Shift + Tab on first element -> go to last
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    }
    // Tab on last element -> go to first
    else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
  
  function handleClickOutside(event: MouseEvent) {
    if (!active || !clickOutsideDeactivates) return;
    
    if (!container.contains(event.target as Node)) {
      deactivate();
    }
  }
  
  function activate() {
    if (active) return;
    
    active = true;
    previousFocus = document.activeElement as HTMLElement;
    
    // Add event listeners
    document.addEventListener('keydown', handleKeyDown);
    if (clickOutsideDeactivates) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    // Focus initial element
    requestAnimationFrame(() => {
      if (initialFocus) {
        initialFocus.focus();
      } else {
        const firstFocusable = getFirstFocusable(container);
        firstFocusable?.focus();
      }
    });
  }
  
  function deactivate() {
    if (!active) return;
    
    active = false;
    
    // Remove event listeners
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('mousedown', handleClickOutside);
    
    // Return focus
    const focusTarget = returnFocus || previousFocus;
    if (focusTarget && document.body.contains(focusTarget)) {
      focusTarget.focus();
    }
  }
  
  return {
    activate,
    deactivate,
    isActive: () => active
  };
}

// =============================================================================
// STEP CHANGE FOCUS
// =============================================================================

/**
 * Focus a heading or container when changing steps in a multi-step form
 * 
 * @example
 * ```tsx
 * function goToStep(stepNumber: number) {
 *   setCurrentStep(stepNumber);
 *   focusStepHeading(`step-${stepNumber}-heading`);
 * }
 * 
 * // In JSX:
 * <h2 id="step-1-heading" tabIndex={-1}>Step 1: Contact Info</h2>
 * ```
 */
export function focusStepHeading(headingId: string): void {
  // Wait for React to render the new step
  requestAnimationFrame(() => {
    const heading = document.getElementById(headingId);
    if (heading) {
      // Make heading focusable if not already
      if (!heading.hasAttribute('tabindex')) {
        heading.setAttribute('tabindex', '-1');
      }
      heading.focus({ preventScroll: false });
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

/**
 * Focus the first input in a step container
 */
export function focusFirstInput(containerId: string): void {
  requestAnimationFrame(() => {
    const container = document.getElementById(containerId);
    if (container) {
      const firstInput = getFirstFocusable(container);
      if (firstInput) {
        firstInput.focus({ preventScroll: false });
        firstInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });
}

// =============================================================================
// SCROLL MARGIN (WCAG 2.4.11 Focus Not Obscured)
// =============================================================================

/**
 * Ensure focused elements are not obscured by sticky headers
 * 
 * @example
 * ```tsx
 * // Call once on app mount
 * setupScrollMargins({ topOffset: 80 }); // Height of sticky header
 * ```
 */
export function setupScrollMargins(options: { topOffset?: number; bottomOffset?: number } = {}): void {
  const { topOffset = 0, bottomOffset = 0 } = options;
  
  // Add CSS for scroll-margin
  const style = document.createElement('style');
  style.textContent = `
    input:focus, 
    select:focus, 
    textarea:focus, 
    button:focus,
    [tabindex]:focus {
      scroll-margin-top: ${topOffset}px;
      scroll-margin-bottom: ${bottomOffset}px;
    }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// SKIP LINKS
// =============================================================================

/**
 * Create a skip link for keyboard navigation
 * 
 * @example
 * ```tsx
 * // At the top of your page
 * <SkipLink targetId="main-content">Skip to main content</SkipLink>
 * <SkipLink targetId="contact-form">Skip to contact form</SkipLink>
 * 
 * // Target element
 * <main id="main-content">...</main>
 * <form id="contact-form">...</form>
 * ```
 */
export function skipTo(targetId: string): void {
  const target = document.getElementById(targetId);
  if (target) {
    // Make target focusable if needed
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: false });
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// =============================================================================
// REACT HOOKS
// =============================================================================

/**
 * React hook for focus trap
 * 
 * @example
 * ```tsx
 * function Modal({ isOpen, onClose, children }) {
 *   const containerRef = useFocusTrap({
 *     active: isOpen,
 *     onEscape: onClose
 *   });
 *   
 *   return isOpen ? <div ref={containerRef}>{children}</div> : null;
 * }
 * ```
 */
export interface UseFocusTrapOptions {
  /** Whether trap is active */
  active: boolean;
  
  /** Callback when escape is pressed */
  onEscape?: () => void;
  
  /** Initial focus element ref */
  initialFocusRef?: React.RefObject<HTMLElement>;
  
  /** Return focus element ref */
  returnFocusRef?: React.RefObject<HTMLElement>;
}

// Note: Actual React hook implementation would import from React
// This is the interface for documentation

/**
 * React hook for focusing first error on form submit
 * 
 * @example
 * ```tsx
 * function MyForm() {
 *   const { formRef, focusError } = useFormErrorFocus();
 *   
 *   function handleSubmit(e) {
 *     e.preventDefault();
 *     const errors = validate();
 *     if (Object.keys(errors).length > 0) {
 *       focusError();
 *       return;
 *     }
 *     submit();
 *   }
 *   
 *   return <form ref={formRef} onSubmit={handleSubmit}>...</form>;
 * }
 * ```
 */
export interface UseFormErrorFocusResult {
  /** Ref to attach to form element */
  formRef: React.RefObject<HTMLFormElement>;
  
  /** Focus the first error field */
  focusError: () => boolean;
  
  /** Get all invalid field elements */
  getInvalidFields: () => FocusableElement[];
}

// =============================================================================
// CSS FOR SKIP LINKS
// =============================================================================

export const skipLinkCSS = `
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  padding: 8px 16px;
  background: #000;
  color: #fff;
  text-decoration: none;
  z-index: 100;
  transition: top 0.2s;
}

.skip-link:focus {
  top: 0;
}
`;
