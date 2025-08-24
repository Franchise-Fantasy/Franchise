const formatPosition = (position: string): string => {
  switch (position.toLowerCase()) {
    case 'guard':
      return 'G';
    case 'forward':
      return 'F';
    case 'center':
      return 'C';
    case 'guard-forward':
    case 'forward-guard':
      return 'G/F';
    case 'forward-center':
    case 'center-forward':
      return 'F/C';
    default:
      return position;
  }
};

export { formatPosition };
