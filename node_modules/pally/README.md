This is a sample module. 

To use the module, follow the instructions as below.
```
$ npm install --global pally
```

In your document, 
```
let Phrase = require("pally");
let foo = new Phrase("var");
```

You can determine whether the content is a palindrome by calling the ```palindrome``` method.
```
foo.palindrome();
// false
```