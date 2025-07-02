import { css } from "lit";

export const sharedKeyframes = css`
  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  @keyframes scale-in {
    from {
      transform: scale(0.95);
    }
    to {
      transform: scale(1);
    }
  }

  @keyframes scale-out {
    from {
      transform: scale(1);
    }
    to {
      transform: scale(0.95);
    }
  }
`;
