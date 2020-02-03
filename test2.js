function QOut() {
    var dest = document.createElement("span")
    document.body.appendChild(dest);
    QQOut.apply(undefined,arguments);
}

function QQOut() {
    var dest = document.body.children;
    dest=dest[dest.length-1];
    if (dest.tagName!="SPAN") {
        dest = document.createElement("span")
        document.body.appendChild(dest);
    }
    var txt = "";
    for(let i=0;i<arguments.length;i++) {
        if(i>0) txt+=" ";
        txt+=arguments[i];
    }
    // dest.textContent = txt;
    $('#output').html( txt );
}

function Replicate( cString, nCount )
{
    return ( cString ).repeat( nCount );
}    

RunHRB();

function RunHRB()
{
   var hrb = new HRB();
   var d = new Date();
   var n = d.getMilliseconds();

   hrb.download("https://www.modharbour.org/modharbour_samples/data/runner.hrb_?" + n ).then((v)=>{
     // hrb.download( "test2.hrb" ).then((v)=>{
     console.log(v);
     hrb.apply();
     MAIN(23);
});
}
