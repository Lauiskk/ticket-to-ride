import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Option {
  value: string;
  label: string;
  icon?: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function CustomSelect({ options, value, onChange, placeholder = 'Selecione...', label }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isOpen && focusedIndex >= 0) {
          onChange(options[focusedIndex].value);
          setIsOpen(false);
        } else {
          setIsOpen(!isOpen);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {label && (
        <label className="block text-sm font-medium text-board-navy/70 mb-1">{label}</label>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-4 py-3 rounded-lg border bg-white text-left flex items-center justify-between
          transition-all duration-200 cursor-pointer
          ${isOpen
            ? 'border-board-gold ring-2 ring-board-gold/30 shadow-md'
            : 'border-board-parchment-dark hover:border-board-wood-light'
          }`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={selectedOption ? 'text-board-navy' : 'text-board-navy/40'}>
          {selectedOption?.label || placeholder}
        </span>

        {/* Chevron */}
        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="w-5 h-5 text-board-wood"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.ul
            initial={{ opacity: 0, scale: 0.95, y: -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-1 bg-board-cream border border-board-parchment-dark
                       rounded-lg shadow-card overflow-hidden"
            role="listbox"
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                  setFocusedIndex(-1);
                }}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`px-4 py-3 cursor-pointer flex items-center gap-2 transition-colors duration-100
                  ${option.value === value
                    ? 'bg-board-gold/20 text-board-navy font-medium'
                    : focusedIndex === index
                      ? 'bg-board-parchment-dark/50 text-board-navy'
                      : 'text-board-navy/80 hover:bg-board-parchment-dark/30'
                  }`}
              >
                {option.icon && <span className="text-lg">{option.icon}</span>}
                <span>{option.label}</span>
                {option.value === value && (
                  <svg className="w-4 h-4 ml-auto text-board-gold" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
