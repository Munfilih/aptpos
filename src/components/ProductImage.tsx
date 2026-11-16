import React, { useEffect, useState } from 'react';

interface ProductImageProps {
  imagePath?: string;
  imageData?: string;
  alt: string;
  className: string;
}

export const ProductImage: React.FC<ProductImageProps> = ({
  imagePath,
  imageData,
  alt,
  className,
}) => {
  const [imageSource, setImageSource] = useState(imageData || '');

  useEffect(() => {
    let active = true;
    setImageSource(imageData || '');

    if (!imagePath) return () => { active = false; };

    if (window.electronAPI?.readProductImage) {
      window.electronAPI.readProductImage(imagePath)
        .then((source) => {
          if (active) setImageSource(source);
        })
        .catch((error: unknown) => {
          console.error('Failed to read product image:', error);
          if (active) setImageSource(imageData || '');
        });
    } else if (/^(https?:\/\/|\/)/i.test(imagePath)) {
      setImageSource(imagePath);
    }

    return () => {
      active = false;
    };
  }, [imageData, imagePath]);

  if (!imageSource) return null;

  return <img src={imageSource} alt={alt} className={className} />;
};
